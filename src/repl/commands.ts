import { input, select, confirm } from '@inquirer/prompts'
import { BrowserManager } from '../scraper/browser.js'
import { CheckpointManager } from '../scraper/checkpoint-manager.js'
import { WorkerPool } from '../scraper/worker-pool.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { logger } from '../utils/logger.js'
import { showHelp } from './help.js'
import { LibraryDiscovery } from '../scraper/library-discovery.js'

export class CommandHandler {
  private checkpointManager: CheckpointManager
  private searchOrchestrator: SearchOrchestrator

  constructor() {
    this.checkpointManager = new CheckpointManager()
    this.searchOrchestrator = new SearchOrchestrator()
  }

  async handleStartLibrary(): Promise<void> {
    await this.runScraperLibrary()
  }

  async handleStartWizard(): Promise<void> {
    const progress = this.checkpointManager.getProgress()

    if (progress.total > 0) {
      console.log()
      const resumeChoice = await select({
        message: `Found checkpoint (${progress.processed}/${progress.total} processed). What do you want to do?`,
        choices: [
          { name: 'Resume from checkpoint', value: 'resume' },
          { name: 'Restart from scratch', value: 'restart' },
          { name: 'Cancel', value: 'cancel' },
        ],
      })

      if (resumeChoice === 'cancel') {
        logger.info('Start cancelled.')
        return
      }

      if (resumeChoice === 'restart') {
        this.checkpointManager.reset()
      }
    }

    await this.runScraperLibrary()
  }

  private async runScraperLibrary(): Promise<void> {
    const browserManager = new BrowserManager()

    try {
      const page = await browserManager.launch()

      if (!this.checkpointManager.isDiscoveryComplete()) {
        logger.info('\n=== Phase 1: Library Discovery ===\n')

        const libraryDiscovery = new LibraryDiscovery()
        const conversations = await libraryDiscovery.discoverFromLibrary(page)

        this.checkpointManager.setDiscoveredConversations(conversations)
      }

      const pending = this.checkpointManager.getPendingConversations()

      if (pending.length === 0) {
        logger.success('All conversations already processed!')
        return
      }

      logger.info(`\n=== Phase 2: Parallel Extraction (${pending.length} pending) ===\n`)

      const browser = (browserManager as any).browser
      const workerPool = new WorkerPool(this.checkpointManager)
      await workerPool.initialize(browser)

      await workerPool.processConversations(pending)

      this.checkpointManager.finalSave()
      await workerPool.close()

      logger.success('\n✨ Export complete!')
    } catch (error) {
      logger.error('Scraping failed:')
      if (error instanceof Error) {
        logger.error(error.message)
      }
    } finally {
      await browserManager.close()
    }
  }

  async handleSearchWizard(): Promise<void> {
    const query = await input({
      message: 'Search query:',
      validate: (value) => (value.trim().length === 0 ? 'Please enter a query.' : true),
    })

    const mode = await select({
      message: 'Search mode:',
      choices: [
        { name: 'Auto (semantic for long queries, exact for short)', value: 'auto' },
        { name: 'Semantic (Ollama + Vectra)', value: 'vector' },
        { name: 'Exact text (ripgrep)', value: 'rg' },
      ],
      default: 'auto',
    })

    const rgOptions = {
      pattern: query,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    }

    logger.info(`Searching for: "${query}" (mode: ${mode})\n`)

    try {
      if (mode === 'vector' || mode === 'auto') {
        await this.validateVectorIfNeeded(mode)
      }

      await this.searchOrchestrator.search(query, mode as 'auto' | 'vector' | 'rg', rgOptions)
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message)
      }
    }
  }

  async handleVectorizeWizard(): Promise<void> {
    console.log()
    const confirmVectorize = await confirm({
      message: 'Rebuild the vector index from exports now?',
      default: true,
    })

    if (!confirmVectorize) {
      logger.info('Vectorization cancelled.')
      return
    }

    try {
      await this.searchOrchestrator.validateVectorSearch()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)

      const retry = await confirm({
        message:
          'Ollama validation failed. Start Ollama (with the embedding model) and retry vectorization?',
        default: false,
      })

      if (!retry) {
        return
      }

      try {
        await this.searchOrchestrator.validateVectorSearch()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(msg)
        return
      }
    }

    await this.searchOrchestrator.vectorizeNow()
  }

  handleHelp(): void {
    showHelp()
  }

  private async validateVectorIfNeeded(mode: 'auto' | 'vector' | 'rg'): Promise<void> {
    if (mode === 'rg') return

    try {
      await this.searchOrchestrator.validateVectorSearch()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)
      logger.info('Start Ollama with the embedding model, then run "vectorize".')
      throw error
    }
  }
}
