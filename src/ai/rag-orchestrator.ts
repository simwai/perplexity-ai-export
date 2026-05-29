import { errorBus } from '../utils/error-bus.js'
import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { type Config } from '../utils/config.js'

let crossEncoderTokenizer: any = null
let crossEncoderModel: any = null

async function getCrossEncoder() {
  const isAlreadyLoaded = crossEncoderTokenizer && crossEncoderModel
  if (isAlreadyLoaded) {
    return { tokenizer: crossEncoderTokenizer, model: crossEncoderModel }
  }

  const transformers = await import('@huggingface/transformers').catch(() => null)
  const isTransformersInstalled =
    transformers && transformers.AutoTokenizer && transformers.AutoModelForSequenceClassification

  if (!isTransformersInstalled) {
    return null
  }

  const { AutoTokenizer, AutoModelForSequenceClassification } = transformers

  crossEncoderTokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
  crossEncoderModel = await AutoModelForSequenceClassification.from_pretrained(
    'Xenova/ms-marco-MiniLM-L-6-v2',
    { dtype: 'int8' }
  )

  return { tokenizer: crossEncoderTokenizer, model: crossEncoderModel }
}

interface ResearchPlan {
  strategy: 'precise' | 'exhaustive'
  queries: string[]
  hardKeywords: string[]
  hydePassage: string
  filters: Record<string, unknown>
}

interface ExtractedFact {
  fact: string
  source_title: string
  thread: string
}

export class RagOrchestrator {
  private readonly vectorStore: VectorStore
  private readonly ollamaClient: OllamaClient
  private readonly ripgrep: RgSearch

  constructor(private readonly config: Config) {
    this.vectorStore = new VectorStore(config)
    this.ollamaClient = new OllamaClient(config)
    this.ripgrep = new RgSearch(config)
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest Adaptive RAG processing: "${question}"`)

    try {
      const researchPlan = await this.developResearchPlan(question)
      const isExhaustiveMode = researchPlan.strategy === 'exhaustive'

      logger.info(`Plan: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (isExhaustiveMode) {
        logger.warn(
          `Exhaustive mode enabled. This may take a while as I'll be doing a deep dive into your history.`
        )
      }

      const hasHardKeywords = researchPlan.hardKeywords?.length > 0
      if (hasHardKeywords) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      if (researchPlan.hydePassage) {
        logger.debug(`HyDE passage generated: "${researchPlan.hydePassage.slice(0, 80)}..."`)
      }

      const searchResults = await this.executeAdaptiveHybridSearch(researchPlan)
      const rerankedResults = await this.crossEncoderRerank(question, searchResults)
      const contextFacts = await this.extractFactsWithGranularMapReduce(
        question,
        rerankedResults,
        isExhaustiveMode
      )

      logger.info(`Synthesizing final answer from ${contextFacts.length} verified facts...`)
      const finalAnswer = await this.generateMightiestResponse(
        question,
        contextFacts,
        researchPlan.strategy
      )

      console.log(`\n${chalk.bold.green('Mightiest AI Response:')}\n`)
      console.log(finalAnswer)

      this.displaySourceProvenance(contextFacts)

      const feedback = await this.verifyAnswerQuality(question, finalAnswer)
      const isImprovementSuggested = feedback.status === 'improvement-needed'
      if (isImprovementSuggested) {
        logger.warn(`Self-Correction: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errorBus.emitError(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developResearchPlan(originalQuestion: string): Promise<ResearchPlan> {
    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
4. HyDE: Write 1-2 sentences that would plausibly appear in a saved answer to this question. Write as if it's content already stored, not as a reply.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "hydePassage": "...", "filters": {}}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      const planJson = this.parseJsonFromResponse(response, {})

      return {
        strategy: planJson.strategy || 'precise',
        queries: planJson.queries || [originalQuestion],
        hardKeywords: planJson.hardKeywords || [],
        hydePassage: planJson.hydePassage || '',
        filters: planJson.filters || {},
      }
    } catch (error) {
      return {
        strategy: 'precise',
        queries: [originalQuestion],
        hardKeywords: [],
        hydePassage: '',
        filters: {},
      }
    }
  }

  private async executeAdaptiveHybridSearch(plan: ResearchPlan): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []

    for (let i = 0; i < (plan.queries || []).length; i++) {
      const searchQuery = plan.queries[i]!
      logger.debug(`Executing semantic search [${i + 1}/${plan.queries.length}]: "${searchQuery}"`)
      const vectorResults = await this.vectorStore.search(searchQuery, 40)
      searchPools.push(vectorResults)
    }

    if (plan.hydePassage) {
      logger.debug(`Executing HyDE search: "${plan.hydePassage.slice(0, 60)}..."`)
      const hydeResults = await this.vectorStore.search(plan.hydePassage, 40)
      searchPools.push(hydeResults)
    }

    const keywordMatchPool: VectorSearchResult[] = []
    for (const hardKeyword of plan.hardKeywords || []) {
      logger.debug(`Executing keyword search: "${hardKeyword}"`)
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: hardKeyword })
        const convertedMatches: VectorSearchResult[] = matches.map((match) => ({
          meta: {
            path: join(this.config.exportDir, match.path),
            snippet: match.text,
            title: match.path.split('/').pop() || 'Untitled',
            id: match.path + match.line,
          },
          score: 1.0,
        }))
        keywordMatchPool.push(...convertedMatches)
      } catch (error) {
        // Silently skip failed keyword searches
      }
    }

    const hasKeywordResults = keywordMatchPool.length > 0
    if (hasKeywordResults) {
      searchPools.push(keywordMatchPool)
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const fusionScores = new Map<string, { result: VectorSearchResult; totalScore: number }>()

    pools.forEach((pool) => {
      pool.forEach((result, rank) => {
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
      })
    })

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

    const RERANK_BATCH_SIZE = 64
    const rerankScores: number[] = new Array(results.length).fill(0)

    for (let i = 0; i < results.length; i += RERANK_BATCH_SIZE) {
      const currentBatch = results.slice(i, i + RERANK_BATCH_SIZE)
      const inputPairs = currentBatch.map((res) => [
        question,
        (res.meta['snippet'] as string) || '',
      ])

      const tokenizedInputs = await tokenizer(
        inputPairs.map((pair) => pair[0]),
        {
          text_pair: inputPairs.map((pair) => pair[1]),
          padding: true,
          truncation: true,
        }
      )

      const modelOutput = await model(tokenizedInputs)
      const batchLogits: number[] = Array.from(modelOutput.logits.data as Float32Array)

      batchLogits.forEach((logit, offset) => {
        rerankScores[i + offset] = logit
      })
    }

    return results
      .map((result, index) => ({ result, rerankScore: rerankScores[index]! }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .map((entry) => entry.result)
  }

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    isExhaustive: boolean
  ): Promise<ExtractedFact[]> {
    const POOL_LIMIT_EXHAUSTIVE = 60
    const POOL_LIMIT_PRECISE = 35
    const poolLimit = isExhaustive ? POOL_LIMIT_EXHAUSTIVE : POOL_LIMIT_PRECISE

    const processingPool = results.slice(0, poolLimit)
    const isPoolEmpty = processingPool.length === 0
    if (isPoolEmpty) return []

    const extractedFindings: ExtractedFact[] = []
    const ANALYSIS_BATCH_SIZE = 10
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

Extract every specific fact, mention, date, or piece of code.
Return JSON array: [{"fact": "...", "node_id": N, "thread": "..."}]
`
      try {
        const response = await this.ollamaClient.generate(researchPrompt)
        const extractedFacts = this.parseJsonFromResponse(response, [])

        extractedFacts.forEach((factEntry: any) => {
          const originalSnippet = processingPool[factEntry.node_id]
          extractedFindings.push({
            fact: factEntry.fact,
            source_title: originalSnippet?.meta['title'] || factEntry.thread || 'Unknown',
            thread: factEntry.thread || originalSnippet?.meta['title'] || 'Unknown',
          })
        })
      } catch (error) {
        currentBatch.forEach((res) => {
          extractedFindings.push({
            fact: res.meta['snippet'] as string,
            source_title: res.meta['title'] as string,
            thread: res.meta['title'] as string,
          })
        })
      }
    }

    return extractedFindings
  }

  private async generateMightiestResponse(
    question: string,
    extractedFacts: ExtractedFact[],
    strategy: string
  ): Promise<string> {
    const synthesisPrompt = `
You are the Narrator. Synthesize these research findings into a cohesive, mightiest answer for: "${question}"
Strategy: ${strategy}
Findings:
${extractedFacts.map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`).join('\n')}

INSTRUCTIONS:
1. Provide a comprehensive, authoritative response.
2. If "exhaustive", list ALL relevant conversations and what they contributed.
3. Be specific with names and technical details.
4. Cite everything with [Find N].

ANSWER:
`
    return this.ollamaClient.generate(synthesisPrompt)
  }

  private displaySourceProvenance(extractedFacts: ExtractedFact[]): void {
    const uniqueSourceTitles = new Set(extractedFacts.map((fact) => fact.source_title))
    const hasSources = uniqueSourceTitles.size > 0

    if (hasSources) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueSourceTitles.forEach((title) => console.log(` - ${title}`))
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
      return this.parseJsonFromResponse(verificationResponse, { status: 'ok' })
    } catch (error) {
      return { status: 'ok' }
    }
  }

  private parseJsonFromResponse(response: string, defaultValue: any): any {
    const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (jsonMatch?.[0]) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (error) {
        return defaultValue
      }
    }
    return defaultValue
  }
}
