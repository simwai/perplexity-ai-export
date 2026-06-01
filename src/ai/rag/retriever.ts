import { type VectorStore, type VectorSearchResult } from '../../search/vector-store.js'
import { type RgSearch } from '../../search/rg-search.js'
import { type ResearchPlan } from './types.js'
import { logger } from '../../utils/logger.js'
import { join } from 'node:path'
import { type Config } from '../../utils/config.js'

export class HybridRetriever {
  constructor(
    private readonly config: Config,
    private readonly vectorStore: VectorStore,
    private readonly ripgrep: RgSearch
  ) {}

  async retrieve(plan: ResearchPlan): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []

    for (const [index, searchQuery] of plan.queries.entries()) {
      logger.debug(`Executing semantic search [${index + 1}/${plan.queries.length}]: "${searchQuery}"`)
      const vectorResults = await this.vectorStore.search(searchQuery, 40)
      searchPools.push(vectorResults)
    }

    if (plan.hydePassage) {
      logger.debug(`Executing HyDE search: "${plan.hydePassage.slice(0, 60)}..."`)
      const hydeResults = await this.vectorStore.search(plan.hydePassage, 40)
      searchPools.push(hydeResults)
    }

    const keywordMatchPool: VectorSearchResult[] = []
    for (const hardKeyword of plan.hardKeywords) {
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
      } catch {
        // Skip failed keyword searches
      }
    }

    if (keywordMatchPool.length > 0) {
      searchPools.push(keywordMatchPool)
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const fusionScores = new Map<string, { result: VectorSearchResult; totalScore: number }>()

    for (const pool of pools) {
      for (const [rank, result] of pool.entries()) {
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
}
