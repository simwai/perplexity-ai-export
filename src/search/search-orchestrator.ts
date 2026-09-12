import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'
import { RagOrchestrator } from '../ai/rag-orchestrator.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { ok, err, createResult, type Result } from 'super-result'

export type SearchMode = 'rg' | 'vector' | 'auto' | 'rag'

export class SearchOrchestratorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SearchOrchestratorError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchOrchestratorValidationError'
  }
}

export class SearchOrchestrator {
  private readonly rgSearch: RgSearch
  private readonly vectorStore: VectorStore
  private readonly ragOrchestrator: RagOrchestrator

  private readonly R = createResult<SearchOrchestratorError>((error: unknown) =>
    error instanceof SearchOrchestratorError ? error : new SearchOrchestratorError(String(error))
  )

  constructor(private readonly config: Config) {
    this.rgSearch = new RgSearch(config)
    this.vectorStore = new VectorStore(config)
    this.ragOrchestrator = new RagOrchestrator(config)
  }

  async validateVectorSearch(): Promise<Result<void, ValidationError>> {
    if (!this.config.enableVectorSearch) {
      return err(new ValidationError('Vector search is disabled (ENABLE_VECTOR_SEARCH=false).'))
    }
    const result = await this.vectorStore.validate()
    if (!result.ok)
      return err(
        new ValidationError(`Vector store validation failed: ${errorMessageOf(result.error)}`)
      )
    return ok(undefined)
  }

  async vectorizeNow(): Promise<Result<void, SearchOrchestratorError>> {
    const result = await this.vectorStore.rebuildFromExports()
    if (!result.ok)
      return err(new SearchOrchestratorError(`Vectorize failed: ${errorMessageOf(result.error)}`))
    return ok(undefined)
  }

  async search(
    query: string,
    mode: SearchMode,
    rgOptions: RgSearchOptions
  ): Promise<Result<void, SearchOrchestratorError>> {
    return this.R.from(async () => {
      switch (mode) {
        case 'rg':
          await this.rgSearch.search(rgOptions)
          break
        case 'vector':
          {
            const result = await this.performVectorOnlySearch(query)
            if (!result.ok) throw result.error
          }
          break
        case 'rag':
          await this.ragOrchestrator.answerQuestion(query)
          break
        case 'auto':
        default:
          await this.executeAutoSearch(query, rgOptions)
          break
      }
    })
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

  private async performVectorOnlySearch(
    query: string
  ): Promise<Result<void, SearchOrchestratorError>> {
    logger.info('Using vector search (Ollama + Vectra)...')
    const SEARCH_RESULT_LIMIT = 10
    const searchResults = await this.vectorStore.search(query, SEARCH_RESULT_LIMIT)

    if (!searchResults.ok) {
      return err(
        new SearchOrchestratorError(`Vector search failed: ${errorMessageOf(searchResults.error)}`)
      )
    }

    const results = searchResults.value
    if (results.length === 0) {
      logger.info('No vector search results found.')
      return ok(undefined)
    }

    for (const result of results) {
      const { meta, score } = result
      const relevanceScoreLabel = score.toFixed(3)

      const spaceNameDisplay = String(meta['spaceName'] ?? '')
      const arrowSeparator = '›'
      const titleDisplay = String(meta['title'] ?? '')
      const scoreDisplay = `(${relevanceScoreLabel})`
      const pathDisplay = String(meta['path'] ?? '')

      logger.info(
        `${spaceNameDisplay} ${arrowSeparator} ${titleDisplay} ${scoreDisplay}\n${pathDisplay}\n`
      )
    }
    return ok(undefined)
  }
}
