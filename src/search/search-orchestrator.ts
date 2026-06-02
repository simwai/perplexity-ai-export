import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'
import { type Config } from '../utils/config.js'
import { RagOrchestrator } from '../ai/rag-orchestrator.js'
import chalk from 'chalk'

export type SearchMode = 'rg' | 'vector' | 'auto' | 'rag'

export class SearchOrchestrator {
  private readonly ripgrepSearch: RgSearch
  private readonly vectorStore: VectorStore
  private readonly ragOrchestrator: RagOrchestrator

  constructor(private readonly applicationConfig: Config) {
    this.ripgrepSearch = new RgSearch(applicationConfig)
    this.vectorStore = new VectorStore(applicationConfig)
    this.ragOrchestrator = new RagOrchestrator(applicationConfig)
  }

  async validateVectorSearch(): Promise<void> {
    if (!this.applicationConfig.enableVectorSearch) {
      errorBus.raiseError('Vector search disabled')
    }
    await this.vectorStore.validate()
  }

  async vectorizeNow(): Promise<void> {
    await this.vectorStore.rebuildFromExports()
  }

  async search(searchQuery: string, searchMode: SearchMode, ripgrepOptions: RgSearchOptions): Promise<void> {
    try {
      switch (searchMode) {
        case 'rg':
          await this.ripgrepSearch.search(ripgrepOptions)
          break
        case 'vector':
          await this.executeVectorOnlySearch(searchQuery)
          break
        case 'rag':
          await this.ragOrchestrator.answerQuestion(searchQuery)
          break
        case 'auto':
        default:
          await this.executeAutoSearch(searchQuery, ripgrepOptions)
          break
      }
    } catch (searchError) {
      errorBus.raiseError(`Search failed`, searchError)
    }
  }

  private async executeAutoSearch(searchQuery: string, ripgrepOptions: RgSearchOptions) {
    const LONG_QUERY_THRESHOLD_WORDS = 5
    const isLongQuery = searchQuery.trim().split(/\s+/).length > LONG_QUERY_THRESHOLD_WORDS

    if (isLongQuery) {
      await this.executeVectorOnlySearch(searchQuery)
    } else {
      await this.ripgrepSearch.search(ripgrepOptions)
    }
  }

  private async executeVectorOnlySearch(searchQuery: string) {
    logger.info('Using semantic search...')
    const MAXIMUM_VECTOR_RESULTS = 10
    const searchResults = await this.vectorStore.search(searchQuery, MAXIMUM_VECTOR_RESULTS)

    if (searchResults.length === 0) {
      logger.info('No results.')
      return
    }

    for (const searchResult of searchResults) {
      const spaceNameDisplay = chalk.green(searchResult.meta['spaceName'] as string)
      const titleDisplay = chalk.cyan(searchResult.meta['title'] as string)
      const relevanceScoreDisplay = chalk.gray(`(${searchResult.score.toFixed(3)})`)
      const filePathDisplay = chalk.gray(searchResult.meta['path'] as string)

      logger.info(`${spaceNameDisplay} › ${titleDisplay} ${relevanceScoreDisplay}\n${filePathDisplay}\n`)
    }
  }
}
