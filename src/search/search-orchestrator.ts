import { RgSearch, type RgSearchOptions } from './rg-search.js'
import { VectorStore } from './vector-store.js'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'
import { type Config } from '../utils/config.js'
import { RagOrchestrator } from '../ai/rag-orchestrator.js'
import chalk from 'chalk'

export type SearchMode = 'rg' | 'vector' | 'auto' | 'rag'

export class SearchOrchestrator {
  private readonly rgSearch: RgSearch
  private readonly vectorStore: VectorStore
  private readonly ragOrchestrator: RagOrchestrator

  constructor(private readonly config: Config) {
    this.rgSearch = new RgSearch(config)
    this.vectorStore = new VectorStore(config)
    this.ragOrchestrator = new RagOrchestrator(config)
  }

  async validateVectorSearch(): Promise<void> {
    if (!this.config.enableVectorSearch) errorBus.raiseError('Vector search disabled')
    await this.vectorStore.validate()
  }

  async vectorizeNow(): Promise<void> {
    await this.vectorStore.rebuildFromExports()
  }

  async search(query: string, mode: SearchMode, rgOptions: RgSearchOptions): Promise<void> {
    try {
      switch (mode) {
        case 'rg': await this.rgSearch.search(rgOptions); break
        case 'vector': await this.vectorOnly(query); break
        case 'rag': await this.ragOrchestrator.answerQuestion(query); break
        case 'auto':
        default: await this.auto(query, rgOptions); break
      }
    } catch (e) {
      errorBus.raiseError(`Search failed`, e)
    }
  }

  private async auto(q: string, opt: RgSearchOptions) {
    if (q.trim().split(/\s+/).length > 5) await this.vectorOnly(q)
    else await this.rgSearch.search(opt)
  }

  private async vectorOnly(q: string) {
    logger.info('Using semantic search...')
    const res = await this.vectorStore.search(q, 10)
    if (res.length === 0) {
      logger.info('No results.')
      return
    }
    for (const r of res) {
      const s = chalk.green(r.meta['spaceName'] as string)
      const t = chalk.cyan(r.meta['title'] as string)
      const score = chalk.gray(`(${r.score.toFixed(3)})`)
      const p = chalk.gray(r.meta['path'] as string)
      logger.info(`${s} › ${t} ${score}\n${p}\n`)
    }
  }
}
