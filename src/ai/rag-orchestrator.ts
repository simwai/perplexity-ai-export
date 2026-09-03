import { errorBus } from '../utils/error-bus.js'
import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient, type ChatMessage, type LlmResponse } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import { join } from 'node:path'
import { type Config } from '../utils/config.js'
import { z } from 'zod'
import { errorMessageOf } from '../utils/extract-error-message.js'

interface CrossEncoderInstance {
  tokenizer: {
    (
      text: string[],
      options?: { text_pair?: string[]; padding?: boolean; truncation?: boolean }
    ): Promise<{ input_ids: number[][]; attention_mask: number[][] }>
  }
  model: {
    (inputs: {
      input_ids: number[][]
      attention_mask: number[][]
    }): Promise<{ logits: { data: Float32Array } }>
  }
}

class CrossEncoder {
  private static instance: CrossEncoderInstance | null = null
  private static loading = false

  static async getInstance(): Promise<CrossEncoderInstance | null> {
    if (CrossEncoder.instance) {
      return CrossEncoder.instance
    }

    if (CrossEncoder.loading) {
      while (CrossEncoder.loading) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return CrossEncoder.instance
    }

    CrossEncoder.loading = true
    try {
      const transformers = await import('@huggingface/transformers').catch(() => null)
      if (!transformers) {
        return null
      }

      const { AutoTokenizer, AutoModelForSequenceClassification } = transformers

      const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
      const model = await AutoModelForSequenceClassification.from_pretrained(
        'Xenova/ms-marco-MiniLM-L-6-v2',
        { dtype: 'int8' }
      )

      CrossEncoder.instance = { tokenizer, model }
      return CrossEncoder.instance
    } catch (error) {
      logger.debug(`Failed to load cross-encoder: ${errorMessageOf(error)}`)
      return null
    } finally {
      CrossEncoder.loading = false
    }
  }

  static resetForTesting(): void {
    CrossEncoder.instance = null
    CrossEncoder.loading = false
  }
}

async function getCrossEncoder(): Promise<CrossEncoderInstance | null> {
  return CrossEncoder.getInstance()
}

const VECTOR_SEARCH_LIMIT = 40
const ANALYSIS_BATCH_SIZE = 10
const RERANK_BATCH_SIZE = 64
const RERANK_RELEVANCE_THRESHOLD = -5.0

const researchPlanJsonSchema = z
  .object({
    strategy: z.enum(['precise', 'exhaustive']).optional(),
    queries: z.array(z.string()).optional(),
    hardKeywords: z.array(z.string()).optional(),
    hydePassage: z.string().optional(),
  })
  .passthrough()

const extractedFactSchema = z.object({
  fact: z.string(),
  node_id: z.coerce.number().int().nonnegative(),
})

const verificationResultSchema = z.object({
  status: z.enum(['ok', 'missed-info']),
  suggestion: z.string().optional(),
})

function parseJsonWithSchema<T>(response: string, schema: z.ZodType<T>, defaultValue: T): T {
  const match = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!match?.[0]) return defaultValue
  try {
    const parsed = JSON.parse(match[0])
    const result = schema.safeParse(parsed)
    if (!result.success) {
      logger.debug(`Schema validation failed: ${result.error.message}`)
    }
    return result.success ? result.data : defaultValue
  } catch (error) {
    logger.debug(`JSON parse failed: ${errorMessageOf(error)}`)
    return defaultValue
  }
}

interface ResearchPlan {
  originalQuestion: string
  strategy: 'precise' | 'exhaustive'
  queries: string[]
  hardKeywords: string[]
  hydePassage: string
}

interface ExtractedFact {
  fact: string
  source_title: string
  thread: string
}

export class OrchestratorError extends Error {
  context?: Record<string, unknown>

  constructor(message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'OrchestratorError'
    this.context = context
  }
}

export class RagOrchestrator {
  static readonly OrchestratorError = OrchestratorError

  private readonly ollamaClient: OllamaClient
  private readonly vectorStore: VectorStore
  private readonly ripgrep: RgSearch

  constructor(private readonly config: Config) {
    this.ollamaClient = new OllamaClient(config)
    this.vectorStore = new VectorStore(config)
    this.ripgrep = new RgSearch(config)
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest RAG is analyzing: "${question}"...`)

    try {
      const plan = await this.developResearchPlan(question)
      const results = await this.executeAdaptiveHybridSearch(plan)
      const rerankedResults = await this.crossEncoderRerank(question, results)

      const isExhaustive = plan.strategy === 'exhaustive'
      const extractedFacts = await this.extractFactsWithGranularMapReduce(
        question,
        rerankedResults,
        isExhaustive
      )

      const answer = await this.generateMightiestResponse(question, extractedFacts, plan.strategy)

      logger.info('\nMightiest Answer:\n')
      logger.info(answer)

      this.displaySourceProvenance(extractedFacts)

      const feedback = await this.verifyAnswerQuality(question, answer)
      const needsCorrection = feedback.status === 'missed-info'
      if (needsCorrection) {
        logger.warn(`Self-Correction: ${feedback.suggestion}`)
      }
    } catch (error) {
      const errorMessage = errorMessageOf(error)
      // why: we accept OrchestratorError-shaped throws from the call graph; non-OrchestratorError gets undefined context
      const errorContext = (error as { context?: Record<string, unknown> })?.context
      const orchestratorError = new RagOrchestrator.OrchestratorError(
        `Mightiest RAG failed: ${errorMessage}`,
        errorContext
      )
      errorBus.emitError(orchestratorError.message, orchestratorError)
    }
  }

  async chat(question: string, history: ChatMessage[]): Promise<LlmResponse> {
    logger.info(`Processing chat turn: "${question}"...`)

    try {
      const refinedQuestion = await this.rephraseQuestionWithHistory(question, history)
      logger.debug(`Refined question for search: "${refinedQuestion}"`)

      const plan = await this.developResearchPlan(refinedQuestion)
      const results = await this.executeAdaptiveHybridSearch(plan)
      const rerankedResults = await this.crossEncoderRerank(refinedQuestion, results)

      const isExhaustive = plan.strategy === 'exhaustive'
      const extractedFacts = await this.extractFactsWithGranularMapReduce(
        refinedQuestion,
        rerankedResults,
        isExhaustive
      )

      const systemPrompt = this.buildChatSystemPrompt(extractedFacts)
      const chatMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: question },
      ]

      const response = await this.ollamaClient.chat(chatMessages)

      this.displaySourceProvenance(extractedFacts)

      return response
    } catch (error) {
      const errorMessage = errorMessageOf(error)
      // why: we accept OrchestratorError-shaped throws from the call graph; non-OrchestratorError gets undefined context
      const errorContext = (error as { context?: Record<string, unknown> })?.context
      const orchestratorError = new RagOrchestrator.OrchestratorError(
        `Mightiest Chat failed: ${errorMessage}`,
        errorContext
      )
      throw orchestratorError
    }
  }

  private async rephraseQuestionWithHistory(
    question: string,
    history: ChatMessage[]
  ): Promise<string> {
    const isHistoryEmpty = history.length === 0
    if (isHistoryEmpty) return question

    const rephrasePrompt = `
Given the following conversation history and a new question, rephrase the new question to be a standalone question that can be used for search.
If the new question is already standalone, return it as is.

History:
${history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

New Question: ${question}

Standalone Question:
`
    const response = await this.ollamaClient.generate(rephrasePrompt)
    return response.trim() || question
  }

  private buildChatSystemPrompt(extractedFacts: ExtractedFact[]): string {
    if (extractedFacts.length === 0) {
      return `You are a helpful assistant answering questions based on the user's exported conversation history.
No relevant findings were retrieved for this question. Inform the user that no relevant information was found in their history, but still try to be helpful with general knowledge if appropriate.`
    }

    const findings = extractedFacts
      .map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`)
      .join('\n')

    return `
You are a helpful assistant answering questions based on the user's exported conversation history.
Use the following research findings to provide an authoritative and specific response.

Findings:
${findings}

INSTRUCTIONS:
1. Provide a cohesive and helpful answer using only findings that directly answer the question.
2. Cite findings by source title in brackets, e.g., [which big python projects use pdm...], matching the History Sources Explored list.
3. If the history doesn't contain relevant information, inform the user but still try to be helpful based on general knowledge if it's a follow-up.
`
  }

  private async developResearchPlan(originalQuestion: string): Promise<ResearchPlan> {
    const isHydeInPlanner = this.config.hydeMode === 'fusion'
    const hydeInstruction = isHydeInPlanner
      ? "4. HyDE: Write 1-2 sentences that would plausibly appear in a saved answer to this question. Write as if it's content already stored, not as a reply."
      : ''

    const jsonTemplate = isHydeInPlanner
      ? '{"strategy": "...", "queries": [], "hardKeywords": [], "hydePassage": "..."}'
      : '{"strategy": "...", "queries": [], "hardKeywords": []}'

    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
${hydeInstruction}
Return JSON: ${jsonTemplate}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      const planJson = parseJsonWithSchema(response, researchPlanJsonSchema, {})

      return {
        originalQuestion,
        strategy: planJson.strategy || 'precise',
        queries:
          planJson.queries && planJson.queries.length > 0 ? planJson.queries : [originalQuestion],
        hardKeywords: planJson.hardKeywords || [],
        hydePassage: planJson.hydePassage || '',
      }
    } catch (error) {
      logger.debug(`Research plan generation failed: ${errorMessageOf(error)}`)
      return {
        strategy: 'precise',
        originalQuestion,
        queries: [originalQuestion],
        hardKeywords: [],
        hydePassage: '',
      }
    }
  }

  private async executeAdaptiveHybridSearch(plan: ResearchPlan): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []
    const hydeMode = this.config.hydeMode

    const queryResults = await Promise.all(
      (plan.queries || []).map(async (searchQuery, index) => {
        logger.debug(
          `Executing semantic search [${index + 1}/${plan.queries.length}]: "${searchQuery}"`
        )
        return this.vectorStore.search(searchQuery, VECTOR_SEARCH_LIMIT)
      })
    )
    searchPools.push(...queryResults)

    if (hydeMode === 'fusion' && plan.hydePassage) {
      logger.debug(`Executing HyDE search (fusion): "${plan.hydePassage.slice(0, 60)}..."`)
      const hydeResults = await this.vectorStore.search(plan.hydePassage, VECTOR_SEARCH_LIMIT)
      searchPools.push(hydeResults)
    } else if (hydeMode === 'supplement') {
      const allSoFar = searchPools.flat()
      const maxScore = allSoFar.reduce((max, res) => Math.max(max, res.score), 0)
      const resultCount = allSoFar.length

      const isWeak =
        maxScore < this.config.hydeThresholdScore || resultCount < this.config.hydeThresholdCount

      if (isWeak) {
        logger.info(
          `Initial results weak (score: ${maxScore.toFixed(2)}, count: ${resultCount}). Triggering HyDE supplement...`
        )
        const hydePassage =
          plan.hydePassage || (await this.generateHydePassage(plan.originalQuestion))
        if (hydePassage) {
          logger.debug(`Executing HyDE search (supplement): "${hydePassage.slice(0, 60)}..."`)
          const hydeResults = await this.vectorStore.search(hydePassage, VECTOR_SEARCH_LIMIT)
          searchPools.push(hydeResults)
        }
      }
    }

    const keywordPools = await Promise.all(
      (plan.hardKeywords || []).map(async (hardKeyword) => {
        logger.debug(`Executing keyword search: "${hardKeyword}"`)
        try {
          const matches = await this.ripgrep.captureSearchMatches({ pattern: hardKeyword })
          return matches.map<VectorSearchResult>((match) => ({
            meta: {
              path: join(this.config.exportDir, match.path),
              snippet: match.text,
              title: match.path.split('/').pop() || 'Untitled',
              id: match.path + match.line,
            },
            score: 1.0,
          }))
        } catch (error) {
          logger.warn(`Keyword search failed for "${hardKeyword}": ${errorMessageOf(error)}`)
          return []
        }
      })
    )

    const keywordMatchPool = keywordPools.flat()
    if (keywordMatchPool.length > 0) {
      searchPools.push(keywordMatchPool)
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const fusionScores = new Map<string, { result: VectorSearchResult; totalScore: number }>()

    for (const pool of pools) {
      for (let rank = 0; rank < pool.length; rank++) {
        const result = pool[rank]!
        const path = result.meta['path'] || 'unknown'
        const snippet = result.meta['snippet'] || ''
        const uniqueId = result.meta['id'] || `${path}:${snippet}`

        const rankScore = 1 / (60 + rank)
        const existingEntry = fusionScores.get(uniqueId)

        if (existingEntry) {
          existingEntry.totalScore += rankScore
        } else {
          fusionScores.set(uniqueId, { result, totalScore: rankScore })
        }
      }
    }

    return Array.from(fusionScores.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((entry) => entry.result)
  }

  private async crossEncoderRerank(
    question: string,
    results: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    const isResultsEmpty = results.length === 0
    if (isResultsEmpty) return results

    const crossEncoder = await getCrossEncoder()
    if (!crossEncoder) {
      logger.debug(
        'Cross-encoder not available (run: npm install @huggingface/transformers). Skipping rerank.'
      )
      return results
    }

    const { tokenizer, model } = crossEncoder
    logger.info(`Cross-encoder reranking ${results.length} candidates...`)

    const rerankScores: number[] = (
      Array.from({ length: results.length }) satisfies Array<number>
    ).fill(0)

    for (let i = 0; i < results.length; i += RERANK_BATCH_SIZE) {
      const currentBatch = results.slice(i, i + RERANK_BATCH_SIZE)
      const inputPairs = currentBatch.map((res) => [
        question,
        (res.meta['snippet'] as string) || '',
      ])

      const tokenizedInputs = await tokenizer(
        inputPairs.map((pair) => pair[0] ?? ''),
        {
          text_pair: inputPairs.map((pair) => pair[1] ?? ''),
          padding: true,
          truncation: true,
        }
      )

      const modelOutput = await model(tokenizedInputs)
      // why: @huggingface/transformers types logits.data as ArrayLike<number>; runtime is Float32Array
      const batchLogits: number[] = Array.from(modelOutput.logits.data as Float32Array)

      for (let offset = 0; offset < batchLogits.length; offset++) {
        rerankScores[i + offset] = batchLogits[offset]!
      }
    }

    const sortedResults = results
      .map((result, index) => ({ result, rerankScore: rerankScores[index]! }))
      .sort((a, b) => b.rerankScore - a.rerankScore)

    const relevantResults = sortedResults
      .filter((entry) => entry.rerankScore >= RERANK_RELEVANCE_THRESHOLD)
      .map((entry) => entry.result)

    if (relevantResults.length === 0) {
      const fallback = sortedResults.slice(0, 20).map((entry) => entry.result)
      logger.debug(
        `Reranked ${results.length} -> 0 above threshold (${RERANK_RELEVANCE_THRESHOLD}), falling back to top ${fallback.length}`
      )
      return fallback
    }

    logger.debug(
      `Reranked ${results.length} -> ${relevantResults.length} above threshold (${RERANK_RELEVANCE_THRESHOLD})`
    )

    return relevantResults
  }

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    isExhaustive: boolean
  ): Promise<ExtractedFact[]> {
    const POOL_LIMIT_EXHAUSTIVE = 80
    const POOL_LIMIT_PRECISE = 50
    const poolLimit = isExhaustive ? POOL_LIMIT_EXHAUSTIVE : POOL_LIMIT_PRECISE

    const processingPool = results.slice(0, poolLimit)
    const isPoolEmpty = processingPool.length === 0
    if (isPoolEmpty) return []

    const extractedFindings: ExtractedFact[] = []
    const totalBatches = Math.ceil(processingPool.length / ANALYSIS_BATCH_SIZE)

    for (
      let batchStartIndex = 0, batchNumber = 1;
      batchStartIndex < processingPool.length;
      batchStartIndex += ANALYSIS_BATCH_SIZE, batchNumber++
    ) {
      const currentBatch = processingPool.slice(
        batchStartIndex,
        batchStartIndex + ANALYSIS_BATCH_SIZE
      )
      logger.info(`Analyzing history snippets... batch ${batchNumber} of ${totalBatches}`)

      const researchPrompt = `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${currentBatch.map((res, index) => `[Node ${batchStartIndex + index}] ${res.meta['title']}: ${res.meta['snippet']}`).join('\n\n')}

Extract facts that answer the question. Prefer facts from DIFFERENT sources (titles) to maximize coverage.
Return JSON array: [{"fact": "...", "node_id": N}]
- fact: a specific claim, code, date, or detail that answers the question
- node_id: the Node index from Context above (0-based)
- Do NOT include a "thread" field - it will be filled from the source title
- Limit: at most 1 fact per unique source title in this batch
`
      try {
        const response = await this.ollamaClient.generate(researchPrompt)
        const match = response.match(/\[[\s\S]*\]/)
        if (!match?.[0]) {
          throw new Error('No JSON array found in response')
        }
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(match[0])
        } catch (parseError) {
          throw new Error(`Invalid JSON in response: ${errorMessageOf(parseError)}`)
        }
        if (!Array.isArray(parsedJson)) {
          throw new Error('Response is not a JSON array')
        }

        for (const factEntry of parsedJson) {
          try {
            const validated = extractedFactSchema.safeParse(factEntry)
            if (!validated.success) {
              logger.debug(`Skipping invalid fact entry: ${validated.error.message}`)
              continue
            }
            const f = validated.data
            if (f.node_id >= processingPool.length) {
              logger.debug(
                `Skipping out-of-range node_id: ${f.node_id} (pool size ${processingPool.length})`
              )
              continue
            }
            const originalSnippet = processingPool[f.node_id]
            const sourceTitle = originalSnippet?.meta['title'] || 'Unknown'
            extractedFindings.push({
              fact: f.fact,
              source_title: sourceTitle,
              thread: sourceTitle,
            })
          } catch (entryError) {
            logger.debug(`Skipping malformed fact entry: ${errorMessageOf(entryError)}`)
          }
        }
      } catch (error) {
        logger.debug(`Fact extraction batch failed: ${errorMessageOf(error)}`)
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] as string,
            source_title: res.meta['title'] as string,
            thread: res.meta['title'] as string,
          })
        }
      }
    }

    return this.filterRelevantFacts(question, extractedFindings)
  }

  private async filterRelevantFacts(
    question: string,
    facts: ExtractedFact[]
  ): Promise<ExtractedFact[]> {
    if (facts.length === 0) return []

    const filterPrompt = `
Question: "${question}"
Facts:
${facts.map((f, i) => `${i}: ${f.fact} (source: ${f.source_title})`).join('\n')}

For each fact, is it related to the question? Mark relevant=true if it mentions Python, programming, or learning that could be relevant context.
Return JSON array: [{"index": 0, "relevant": true}, {"index": 1, "relevant": false}, ...]
`
    try {
      const response = await this.ollamaClient.generate(filterPrompt)
      const match = response.match(/\[[\s\S]*\]/)
      if (!match?.[0]) return facts
      const parsed: Array<{ index: number; relevant: boolean }> = JSON.parse(match[0])
      const relevantIndices = new Set(parsed.filter((p) => p.relevant).map((p) => p.index))
      let filtered = facts.filter((_, i) => relevantIndices.has(i))

      if (filtered.length === 0) {
        logger.debug(`Filtered ${facts.length} -> 0, relaxing to keep all`)
        filtered = facts
      }

      // Deduplicate: keep best fact per unique source title
      const seenSources = new Set<string>()
      const deduped: ExtractedFact[] = []
      for (const fact of filtered) {
        const key = fact.source_title.toLowerCase().trim()
        if (!seenSources.has(key)) {
          seenSources.add(key)
          deduped.push(fact)
        }
      }

      if (deduped.length !== filtered.length) {
        logger.debug(`Deduplicated ${filtered.length} -> ${deduped.length} unique sources`)
      }

      return deduped
    } catch (error) {
      logger.debug(`Relevance filter failed: ${errorMessageOf(error)}`)
      return facts
    }
  }

  private async generateHydePassage(question: string): Promise<string> {
    const hydePrompt = `
Write 1-2 sentences that would plausibly appear in a saved answer to the question: "${question}"
Write as if it's content already stored in a document, not as a direct reply.
`
    try {
      return await this.ollamaClient.generate(hydePrompt)
    } catch (error) {
      logger.debug(`HyDE passage generation failed: ${errorMessageOf(error)}`)
      return ''
    }
  }

  private async generateMightiestResponse(
    question: string,
    extractedFacts: ExtractedFact[],
    strategy: string
  ): Promise<string> {
    if (extractedFacts.length === 0) {
      return 'No relevant information found in your history for this question.'
    }
    const synthesisPrompt = `
You are the Narrator. Synthesize these research findings into a cohesive answer for: "${question}"
Strategy: ${strategy}
Findings:
${extractedFacts.map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`).join('\n')}

INSTRUCTIONS:
1. Only use findings that are DIRECTLY relevant to the question.
2. If a finding is irrelevant, do not cite it and do not mention it.
3. Be specific with names and technical details from the findings.
4. Cite relevant findings using the source title in brackets, e.g., [which big python projects use pdm...].
5. If no findings are relevant, say "No relevant information found in your history."

ANSWER:
`
    return this.ollamaClient.generate(synthesisPrompt)
  }
  private displaySourceProvenance(extractedFacts: ExtractedFact[]): void {
    if (extractedFacts.length === 0) return

    logger.info('\nHistory Sources Explored:')
    for (let index = 0; index < extractedFacts.length; index++) {
      const fact = extractedFacts[index]!
      const shortTitle =
        fact.source_title.length > 60 ? fact.source_title.slice(0, 57) + '...' : fact.source_title
      logger.info(`  [Find ${index}] ${shortTitle}`)
      if (fact.fact.length > 120) {
        logger.info(`      ${fact.fact.slice(0, 117)}...`)
      } else {
        logger.info(`      ${fact.fact}`)
      }
    }
  }

  private async verifyAnswerQuality(
    question: string,
    answer: string
  ): Promise<{ status: string; suggestion?: string }> {
    const verificationPrompt = `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
    try {
      const verificationResponse = await this.ollamaClient.generate(verificationPrompt)
      return parseJsonWithSchema(verificationResponse, verificationResultSchema, { status: 'ok' })
    } catch (error) {
      logger.warn(`Answer verification failed: ${errorMessageOf(error)}`)
      return { status: 'ok' }
    }
  }
}
