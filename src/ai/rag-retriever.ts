import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { RipgrepSearch } from '../search/rg-search.js'
import { logger } from '../utils/logging/logger.js'
import { join } from 'node:path'
import { type Config } from '../utils/config.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { getCrossEncoder } from './cross-encoder.js'
import { type ResearchPlan } from './rag-types.js'
import { RagPlanner } from './rag-planner.js'

const VECTOR_SEARCH_LIMIT = 40
const RERANK_BATCH_SIZE = 64
const RERANK_RELEVANCE_THRESHOLD = -5.0

export class RagRetriever {
  constructor(
    private readonly config: Config,
    private readonly vectorStore: VectorStore,
    private readonly ripgrep: RipgrepSearch,
    private readonly planner: RagPlanner
  ) {}

  async executeAdaptiveHybridSearch(plan: ResearchPlan): Promise<VectorSearchResult[]> {
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
          plan.hydePassage || (await this.planner.generateHydePassage(plan.originalQuestion))
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

  mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
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

  async crossEncoderRerank(
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
}
