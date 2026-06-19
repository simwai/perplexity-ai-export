import { type VectorStore, type VectorSearchResult } from '../../search/vector-store.js'
import { type RgSearch } from '../../search/rg-search.js'
import { type ResearchPlan } from './types.js'
import { logger } from '../../utils/logger.js'
import { join } from 'node:path'
import { type Config } from '../../utils/config.js'

export class HybridRetriever {
  constructor(
    private readonly applicationConfig: Config,
    private readonly conversationVectorStore: VectorStore,
    private readonly ripgrepSearchEngine: RgSearch
  ) {}

  async retrieve(researchPlan: ResearchPlan): Promise<VectorSearchResult[]> {
    const searchResultPools: VectorSearchResult[][] = []

    for (const [queryIndex, searchQuery] of researchPlan.searchQueries.entries()) {
      logger.debug(
        `Executing semantic search [${queryIndex + 1}/${researchPlan.searchQueries.length}]: "${searchQuery}"`
      )
      const semanticVectorResults = await this.conversationVectorStore.search(searchQuery, 40)
      searchResultPools.push(semanticVectorResults)
    }

    if (researchPlan.hypotheticalDocumentEmbeddingsPassage) {
      logger.debug(
        `Executing HyDE search: "${researchPlan.hypotheticalDocumentEmbeddingsPassage.slice(0, 60)}..."`
      )
      const hydeVectorResults = await this.conversationVectorStore.search(
        researchPlan.hypotheticalDocumentEmbeddingsPassage,
        40
      )
      searchResultPools.push(hydeVectorResults)
    }

    const keywordMatchPool: VectorSearchResult[] = []
    for (const hardKeyword of researchPlan.hardKeywordsForExactMatch) {
      logger.debug(`Executing keyword search: "${hardKeyword}"`)
      try {
        const ripgrepMatches = await this.ripgrepSearchEngine.captureSearchMatches({
          pattern: hardKeyword,
        })
        const convertedMatches: VectorSearchResult[] = ripgrepMatches.map((match) => ({
          meta: {
            path: join(this.applicationConfig.exportDir, match.path),
            snippet: match.text,
            title: match.path.split('/').pop() || 'Untitled',
            id: match.path + match.line,
          },
          score: 1.0,
        }))
        keywordMatchPool.push(...convertedMatches)
      } catch (ripgrepError) {
        // Skip failed keyword searches silently as per design
      }
    }

    if (keywordMatchPool.length > 0) {
      searchResultPools.push(keywordMatchPool)
    }

    return this.executeReciprocalRankFusion(searchResultPools)
  }

  private executeReciprocalRankFusion(resultPools: VectorSearchResult[][]): VectorSearchResult[] {
    const fusionRankScores = new Map<
      string,
      { searchResult: VectorSearchResult; cumulativeFusionScore: number }
    >()

    for (const individualPool of resultPools) {
      for (const [itemRank, searchResult] of individualPool.entries()) {
        const filePath = searchResult.meta['path'] || 'unknown'
        const textSnippet = searchResult.meta['snippet'] || ''
        const uniqueResultIdentifier = searchResult.meta['id'] || `${filePath}:${textSnippet}`

        const rankConstant = 60
        const itemRankScore = 1 / (rankConstant + itemRank)
        const existingFusionEntry = fusionRankScores.get(uniqueResultIdentifier)

        if (existingFusionEntry) {
          existingFusionEntry.cumulativeFusionScore += itemRankScore
        } else {
          fusionRankScores.set(uniqueResultIdentifier, {
            searchResult,
            cumulativeFusionScore: itemRankScore,
          })
        }
      }
    }

    return Array.from(fusionRankScores.values())
      .sort(
        (firstEntry, secondEntry) =>
          secondEntry.cumulativeFusionScore - firstEntry.cumulativeFusionScore
      )
      .map((fusionEntry) => fusionEntry.searchResult)
  }
}
