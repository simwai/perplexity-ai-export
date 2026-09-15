import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { AiClient, type ChatMessage, type LlmResponse } from './ai-client.js'
import { RipgrepSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import { join } from 'node:path'
import { type Config } from '../utils/config.js'
import { z } from 'zod'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { getCrossEncoder } from './cross-encoder.js'
import { createResult, ok, err, from, type Result } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/api-diagnostics.js'

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

  private readonly config: Config
  private readonly aiClient: AiClient
  private readonly vectorStore: VectorStore
  private readonly ripgrep: RipgrepSearch
  private readonly diagnosticsWriter: ApiDiagnosticsWriter

  private readonly resultFactory = createResult<OrchestratorError>((error: unknown) =>
    error instanceof OrchestratorError ? error : new OrchestratorError(String(error))
  )

  constructor(config: Config) {
    this.config = config
    this.aiClient = new AiClient(config)
    this.vectorStore = new VectorStore(config)
    this.ripgrep = new RipgrepSearch(config)
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
  }

  private parseJsonWithSchema<T>(
    response: string,
    schema: z.ZodType<T>,
    defaultValue: T,
    context: string
  ): T {
    const match = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match?.[0]) return defaultValue
    const parseResult = from(() => JSON.parse(match[0]!))
    if (!parseResult.ok) {
      logger.debug(`JSON parse failed`)
      return defaultValue
    }
    const result = schema.safeParse(parseResult.value)
    if (!result.success) {
      logger.debug(`Schema validation failed: ${result.error.message}`)
      const paths = zodErrorPaths(result)
      this.diagnosticsWriter
        .writeFailure({
          url: `rag://${context}`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        .catch(() => {})
    }
    return result.success ? result.data : defaultValue
  }

  async answerQuestion(question: string): Promise<Result<void, OrchestratorError>> {
    logger.info(`Mightiest RAG is analyzing: "${question}"...`)

    return this.resultFactory.from(async () => await this.runAnswerQuestionFlow(question))
  }

  private async runAnswerQuestionFlow(question: string): Promise<void> {
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
  }

  async chat(
    question: string,
    history: ChatMessage[]
  ): Promise<Result<LlmResponse, OrchestratorError>> {
    logger.info(`Processing chat turn: "${question}"...`)

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

    const chatResult = await this.aiClient.chat(chatMessages)
    if (!chatResult.ok) {
      return err(new OrchestratorError(`Chat failed: ${errorMessageOf(chatResult.error)}`))
    }

    const response = chatResult.value

    this.displaySourceProvenance(extractedFacts)

    return ok(response)
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
    const response = await this.aiClient.generate(rephrasePrompt)
    return response.ok ? response.value.trim() || question : question
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
    const generateResult = await this.aiClient.generate(plannerPrompt)

    if (!generateResult.ok) {
      logger.debug(`Research plan generation failed: ${errorMessageOf(generateResult.error)}`)
      return {
        strategy: 'precise',
        originalQuestion,
        queries: [originalQuestion],
        hardKeywords: [],
        hydePassage: '',
      }
    }

    const planJson = this.parseJsonWithSchema(
      generateResult.value,
      researchPlanJsonSchema,
      {},
      'research-plan'
    )

    return {
      originalQuestion,
      strategy: planJson.strategy || 'precise',
      queries:
        planJson.queries && planJson.queries.length > 0 ? planJson.queries : [originalQuestion],
      hardKeywords: planJson.hardKeywords || [],
      hydePassage: planJson.hydePassage || '',
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
        const searchResult = await this.vectorStore.search(searchQuery, VECTOR_SEARCH_LIMIT)
        return searchResult.ok ? searchResult.value : []
      })
    )
    searchPools.push(...queryResults)

    if (hydeMode === 'fusion' && plan.hydePassage) {
      logger.debug(`Executing HyDE search (fusion): "${plan.hydePassage.slice(0, 60)}..."`)
      const hydeResults = await this.vectorStore.search(plan.hydePassage, VECTOR_SEARCH_LIMIT)
      if (hydeResults.ok) searchPools.push(hydeResults.value)
    } else if (hydeMode === 'supplement') {
      const allSoFar = searchPools.flat()
      let maxScore = 0
      for (const res of allSoFar) {
        if (res.score > maxScore) maxScore = res.score
      }
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
          if (hydeResults.ok) searchPools.push(hydeResults.value)
        }
      }
    }

    const keywordPools = await Promise.all(
      (plan.hardKeywords || []).map(async (hardKeyword) => {
        logger.debug(`Executing keyword search: "${hardKeyword}"`)
        const matchesResult = await this.ripgrep.captureSearchMatches({ pattern: hardKeyword })
        if (!matchesResult.ok) {
          logger.warn(
            `Keyword search failed for "${hardKeyword}": ${errorMessageOf(matchesResult.error)}`
          )
          return []
        }
        const matches = matchesResult.value
        return matches.map<VectorSearchResult>((match) => ({
          meta: {
            path: join(this.config.exportDir, match.path),
            snippet: match.text,
            title: match.path.split('/').pop() || 'Untitled',
            id: match.path + match.line,
          },
          score: 1.0,
        }))
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

    const crossEncoderResult = await getCrossEncoder()
    if (!crossEncoderResult.ok || !crossEncoderResult.value) {
      logger.debug(
        'Cross-encoder not available (run: npm install @huggingface/transformers). Skipping rerank.'
      )
      return results
    }

    const { tokenizer, model } = crossEncoderResult.value
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
      const response = await this.aiClient.generate(researchPrompt)
      if (!response.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(response.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }
      const match = response.value.match(/\[[\s\S]*\]/)
      if (!match) {
        const parseErrorResult = err(new OrchestratorError('No JSON array found in response'))
        if (!parseErrorResult.ok) {
          logger.warn(
            `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseErrorResult.error)}`
          )
          for (const res of currentBatch) {
            extractedFindings.push({
              fact: res.meta['snippet'] ?? '',
              source_title: res.meta['title'] ?? '',
              thread: res.meta['title'] ?? '',
            })
          }
          continue
        }
      }
      const jsonText = (match as RegExpMatchArray)[0]
      if (!jsonText) {
        const parseErrorResult = err(new OrchestratorError('No JSON array found in response'))
        if (!parseErrorResult.ok) {
          logger.warn(
            `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseErrorResult.error)}`
          )
          for (const res of currentBatch) {
            extractedFindings.push({
              fact: res.meta['snippet'] ?? '',
              source_title: res.meta['title'] ?? '',
              thread: res.meta['title'] ?? '',
            })
          }
          continue
        }
      }
      const parseResult = await this.resultFactory.from(() => JSON.parse(jsonText))
      if (!parseResult.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseResult.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }
      const parsedJson = parseResult.value
      const arrayCheckResult = !Array.isArray(parsedJson)
        ? err(new OrchestratorError('Response is not a JSON array'))
        : ok(undefined)
      if (!arrayCheckResult.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(arrayCheckResult.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }

      for (const factEntry of parsedJson) {
        const validated = extractedFactSchema.safeParse(factEntry)
        if (!validated.success) {
          logger.debug(`Skipping invalid fact entry: ${validated.error.message}`)
          const paths = zodErrorPaths(validated)
          this.diagnosticsWriter
            .writeFailure({
              url: 'rag://extract-facts',
              errorType: 'zod_error',
              zodErrorPaths: paths,
            })
            .catch(() => {})
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

For each fact, is it related to the question? Mark relevant=true if the fact contains information that could be relevant context for answering the question.
Return JSON array: [{"index": 0, "relevant": true}, {"index": 1, "relevant": false}, ...]
`
    const filterResponse = await this.aiClient.generate(filterPrompt)
    if (!filterResponse.ok) {
      logger.warn(
        `Relevance filter failed for question "${question}": ${errorMessageOf(filterResponse.error)}`
      )
      return facts
    }
    const match = filterResponse.value.match(/\[[\s\S]*\]/)
    if (!match?.[0]) return facts
    const parseResult = from(() => JSON.parse(match[0]!))
    if (!parseResult.ok) return facts
    const parsed: Array<{ index: number; relevant: boolean }> = parseResult.value
    const relevantIndices = new Set(parsed.filter((p) => p.relevant).map((p) => p.index))
    let filtered = facts.filter((_, i) => relevantIndices.has(i))

    if (filtered.length === 0) {
      logger.debug(`Filtered ${facts.length} -> 0, relaxing to keep all`)
      filtered = facts
    }

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
  }

  private async generateHydePassage(question: string): Promise<string> {
    const hydePrompt = `
Write 1-2 sentences that would plausibly appear in a saved answer to the question: "${question}"
Write as if it's content already stored in a document, not as a direct reply.
`
    const response = await this.aiClient.generate(hydePrompt)
    return response.ok ? response.value : ''
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
    const response = await this.aiClient.generate(synthesisPrompt)
    return response.ok ? response.value : 'Failed to generate answer.'
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
    const verifyResponse = await this.aiClient.generate(verificationPrompt)
    return this.parseJsonWithSchema(
      verifyResponse.ok ? verifyResponse.value : '',
      verificationResultSchema,
      { status: 'ok' },
      'verification'
    )
  }
}
