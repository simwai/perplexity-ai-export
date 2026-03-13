import { input, select, confirm } from '@inquirer/prompts'
import { rmSync } from 'node:fs'
import { BrowserManager } from '../scraper/browser.js'
import { CheckpointManager } from '../scraper/checkpoint-manager.js'
import { WorkerPool } from '../scraper/worker-pool.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { logger } from '../utils/logger.js'
import { showHelp } from './help.js'
import { LibraryDiscovery } from '../scraper/library-discovery.js'
import { config } from '../utils/config.js'

export class CommandHandler {
  // ========== Custom Error Classes ==========
  static readonly ScraperError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ScraperError'
    }
  }

  static readonly SearchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'SearchError'
    }
  }

  static readonly VectorizeError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorizeError'
    }
  }

  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ValidationError'
    }
  }

  static readonly ResetError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ResetError'
    }
  }

  private checkpointManager: CheckpointManager
  private searchOrchestrator: SearchOrchestrator

  constructor() {
    this.checkpointManager = new CheckpointManager()
    this.searchOrchestrator = new SearchOrchestrator()
  }

  // ========== Public Command Handlers ==========
  async handleStartLibrary(): Promise<void> {
    try {
      await this.runScraperLibrary()
    } catch (error) {
      logger.error('Scraper failed:', error instanceof Error ? error : String(error))
    }
  }

  async handleStartWizard(): Promise<void> {
    const progress = this.checkpointManager.getProgress()

    if (progress.total > 0) {
      await this.handleCheckpointPrompt()
    }

    await this.runScraperLibrary()
  }

  async handleSearchWizard(): Promise<void> {
    const query = await this.promptSearchQuery()
    const mode = await this.promptSearchMode()
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
      await this.handleValidationRetry(error)
      return
    }

    await this.searchOrchestrator.vectorizeNow()
  }

  async handleReset(): Promise<void> {
    const confirmed = await confirm({
      message:
        '⚠️  This will delete all stored checkpoints, authentication data, and vector index. Are you sure?',
      default: false,
    })

    if (!confirmed) {
      logger.info('Reset cancelled.')
      return
    }

    try {
      this.deleteStorageFolder()
      this.checkpointManager.reset() // also reset in-memory state
      logger.success('✅ Storage folder deleted. All progress has been reset.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CommandHandler.ResetError(`Failed to reset: ${message}`)
    }
  }

  handleHelp(): void {
    showHelp()
  }

  // ========== Private Helpers ==========

  /**
   * Run the full library scraping process.
   * @throws {CommandHandler.ScraperError} on fatal errors.
   */
  private async runScraperLibrary(): Promise<void> {
    const browserManager = new BrowserManager()

    try {
      const page = await browserManager.launch()

      if (!this.checkpointManager.isDiscoveryComplete()) {
        await this.runDiscoveryPhase(page)
      }

      const pending = this.checkpointManager.getPendingConversations()

      if (pending.length === 0) {
        logger.success('All conversations already processed!')
        return
      }

      await this.runExtractionPhase(browserManager, pending)

      logger.success('\n✨ Export complete!')
    } catch (error) {
      throw new CommandHandler.ScraperError(
        `Scraping failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      await browserManager.close()
    }
  }

  /**
   * Phase 1: Discover all conversations via library API.
   */
  private async runDiscoveryPhase(page: any): Promise<void> {
    logger.info('\n=== Phase 1: Library Discovery ===\n')
    const libraryDiscovery = new LibraryDiscovery()
    const conversations = await libraryDiscovery.discoverFromLibrary(page)
    this.checkpointManager.setDiscoveredConversations(conversations)
  }

  /**
   * Phase 2: Extract conversations using worker pool.
   */
  private async runExtractionPhase(browserManager: BrowserManager, pending: any[]): Promise<void> {
    logger.info(`\n=== Phase 2: Parallel Extraction (${pending.length} pending) ===\n`)

    const browser = browserManager.browser
    if (!browser) {
      throw new CommandHandler.ScraperError('Browser was not initialized')
    }

    const workerPool = new WorkerPool(this.checkpointManager)
    await workerPool.initialize(browser)

    try {
      await workerPool.processConversations(pending)
      this.checkpointManager.finalSave()
    } finally {
      await workerPool.close()
    }
  }

  /**
   * Prompt user about resuming/restarting when a checkpoint exists.
   */
  private async handleCheckpointPrompt(): Promise<void> {
    const progress = this.checkpointManager.getProgress()

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
      process.exit(0)
    }

    if (resumeChoice === 'restart') {
      this.checkpointManager.reset()
    }
  }

  /**
   * Prompt for search query.
   */
  private async promptSearchQuery(): Promise<string> {
    return input({
      message: 'Search query:',
      validate: (value) => (value.trim().length === 0 ? 'Please enter a query.' : true),
    })
  }

  /**
   * Prompt for search mode.
   */
  private async promptSearchMode(): Promise<string> {
    return select({
      message: 'Search mode:',
      choices: [
        { name: 'Auto (semantic for long queries, exact for short)', value: 'auto' },
        { name: 'Semantic (Ollama + Vectra)', value: 'vector' },
        { name: 'Exact text (ripgrep)', value: 'rg' },
      ],
      default: 'auto',
    })
  }

  /**
   * Validate vector search availability if mode requires it.
   */
  private async validateVectorIfNeeded(mode: string): Promise<void> {
    if (mode === 'rg') return

    try {
      await this.searchOrchestrator.validateVectorSearch()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(message)
      logger.info('Start Ollama with the embedding model, then run "vectorize".')
      throw new CommandHandler.ValidationError(message)
    }
  }

  /**
   * Handle validation failure during vectorize wizard.
   */
  private async handleValidationRetry(error: unknown): Promise<void> {
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

    // If validation passed, continue to vectorization
    await this.searchOrchestrator.vectorizeNow()
  }

  /**
   * Delete the .storage folder and all its contents.
   * Uses the storage path from config
   */
  private deleteStorageFolder(): void {
    const storagePath = config.authStoragePath || '.storage' // fallback if not defined
    try {
      rmSync(storagePath, { recursive: true, force: true })
      logger.debug(`Deleted storage folder: ${storagePath}`)
    } catch (error) {
      // If folder doesn't exist, it's fine – we just do nothing
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
}
