import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'
import { RagOrchestrator } from '../ai/rag-orchestrator.js'
import chalk from 'chalk'

export type SearchMode = 'rg' | 'vector' | 'auto' | 'rag'

export class SearchOrchestrator {
  static readonly SearchOrchestratorError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'SearchOrchestratorError'
    }
  }

  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'SearchOrchestratorValidationError'
    }
  }

  private readonly rgSearch: RgSearch
  private readonly vectorStore: VectorStore
  private readonly ragOrchestrator: RagOrchestrator

  constructor(private readonly config: Config) {
    this.rgSearch = new RgSearch(config)
    this.vectorStore = new VectorStore(config)
    this.ragOrchestrator = new RagOrchestrator(config)
  }

  async validateVectorSearch(): Promise<void> {
    if (!this.config.enableVectorSearch) {
      const vectorSearchDisabledErrorMessage =
        'Vector search is disabled (ENABLE_VECTOR_SEARCH=false).'
      throw new SearchOrchestrator.ValidationError(vectorSearchDisabledErrorMessage)
    }
    await this.vectorStore.validate()
  }

  async vectorizeNow(): Promise<void> {
    await this.vectorStore.rebuildFromExports()
  }

  async search(query: string, mode: SearchMode, rgOptions: RgSearchOptions): Promise<void> {
    try {
      switch (mode) {
        case 'rg':
          await this.rgSearch.search(rgOptions)
          break
        case 'vector':
          await this.performVectorOnlySearch(query)
          break
        case 'rag':
          await this.ragOrchestrator.answerQuestion(query)
          break
        case 'auto':
        default:
          await this.executeAutoSearch(query, rgOptions)
          break
      }
    } catch (_error) {
      if (_error instanceof Error) {
        const searchFailedErrorMessage = `Search failed: ${_error.message}`
        throw new SearchOrchestrator.SearchOrchestratorError(searchFailedErrorMessage)
      }
      throw _error
    }
  }

  private async executeAutoSearch(query: string, rgOptions: RgSearchOptions): Promise<void> {
    const LONG_QUERY_WORD_COUNT_THRESHOLD = 5
    const queryWordCount = query.trim().split(/\s+/).length
    const isLongQuery = queryWordCount > LONG_QUERY_WORD_COUNT_THRESHOLD

    if (isLongQuery) {
      await this.performVectorOnlySearch(query)
    } else {
      await this.rgSearch.search(rgOptions)
    }
  }

  private async performVectorOnlySearch(query: string): Promise<void> {
    logger.info('Using vector search (Ollama + Vectra)...')
    const SEARCH_RESULT_LIMIT = 10
    const searchResults = await this.vectorStore.search(query, SEARCH_RESULT_LIMIT)

    if (searchResults.length === 0) {
      logger.info('No vector search results found.')
      return
    }

    for (const result of searchResults) {
      const { meta, score } = result
      const relevanceScoreLabel = score.toFixed(3)

      const spaceNameDisplay = chalk.green(meta['spaceName'] as string)
      const arrowSeparator = chalk.gray('›')
      const titleDisplay = chalk.cyan(meta['title'] as string)
      const scoreDisplay = chalk.gray(`(${relevanceScoreLabel})`)
      const pathDisplay = chalk.gray(meta['path'] as string)

      logger.info(
        `${spaceNameDisplay} ${arrowSeparator} ${titleDisplay} ${scoreDisplay}\n${pathDisplay}\n`
      )
    }
  }
}
