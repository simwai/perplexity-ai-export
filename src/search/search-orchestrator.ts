import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
import chalk from 'chalk'

export type SearchMode = 'rg' | 'vector' | 'auto'

export class SearchOrchestrator {
  private rgSearch: RgSearch
  private vectorStore: VectorStore

  constructor() {
    this.rgSearch = new RgSearch()
    this.vectorStore = new VectorStore()
  }

  async validateVectorSearch(): Promise<void> {
    if (!config.enableVectorSearch) {
      throw new Error('Vector search is disabled (ENABLE_VECTOR_SEARCH=false).')
    }
    await this.vectorStore.validate()
  }

  async vectorizeNow(): Promise<void> {
    await this.vectorStore.rebuildFromExports()
  }

  async search(query: string, mode: SearchMode, rgOptions: RgSearchOptions): Promise<void> {
    if (mode === 'rg') {
      await this.rgSearch.search(rgOptions)
      return
    }

    if (mode === 'vector') {
      await this.searchVectorOnly(query)
      return
    }

    if (query.trim().split(/\s+/).length > 5) {
      await this.searchVectorOnly(query)
    } else {
      await this.rgSearch.search(rgOptions)
    }
  }

  private async searchVectorOnly(query: string): Promise<void> {
    logger.info('Using vector search (Ollama + Vectra)...')
    const results = await this.vectorStore.search(query, 10)

    if (results.length === 0) {
      logger.info('No vector search results.')
      return
    }

    for (const result of results) {
      const { meta, score } = result
      const rel = score.toFixed(3)
      console.log(
        `${chalk.green(meta.spaceName)} ${chalk.gray('›')} ${chalk.cyan(
          meta.title
        )} ${chalk.gray(`(${rel})`)}\\n${chalk.gray(meta.path)}\\n`
      )
    }
  }
}
