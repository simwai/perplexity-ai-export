import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
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

  private rgSearch: RgSearch
  private vectorStore: VectorStore
  private ragOrchestrator: RagOrchestrator

  constructor() {
    this.rgSearch = new RgSearch()
    this.vectorStore = new VectorStore()
    this.ragOrchestrator = new RagOrchestrator()
  }

  async validateVectorSearch(): Promise<void> {
    if (!config.enableVectorSearch) {
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
      if (mode === 'rg') {
        await this.rgSearch.search(rgOptions)
      } else if (mode === 'vector') {
        await this.performVectorOnlySearch(query)
      } else if (mode === 'rag') {
        await this.ragOrchestrator.answerQuestion(query)
      } else {
        await this.executeAutoSearch(query, rgOptions)
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
    const queryWordCountThreshold = 5
    const isLongQuery = query.trim().split(/\s+/).length > queryWordCountThreshold
    if (isLongQuery) {
      await this.performVectorOnlySearch(query)
    } else {
      await this.rgSearch.search(rgOptions)
    }
  }

  private async performVectorOnlySearch(query: string): Promise<void> {
    logger.info('Using vector search (Ollama + Vectra)...')
    const searchResultLimit = 10
    const searchResults = await this.vectorStore.search(query, searchResultLimit)

    if (searchResults.length === 0) {
      logger.info('No vector search results found.')
      return
    }

    for (const result of searchResults) {
      const { meta, score } = result
      const relevanceScore = score.toFixed(3)
      logger.info(
        `${chalk.green(meta['spaceName'])} ${chalk.gray('›')} ${chalk.cyan(
          meta['title']
        )} ${chalk.gray(`(${relevanceScore})`)}\n${chalk.gray(meta['path'])}\n`
      )
    }
  }
}
