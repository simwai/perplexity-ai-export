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

  private progressCheckpointManager: CheckpointManager
  private conversationSearchOrchestrator: SearchOrchestrator

  constructor() {
    this.progressCheckpointManager = new CheckpointManager()
    this.conversationSearchOrchestrator = new SearchOrchestrator()
  }

  async handleStartLibraryExport(): Promise<void> {
    try {
      await this.executeFullScrapingFlow()
    } catch (_error) {
      logger.error('Scraper failed:', _error instanceof Error ? _error : String(_error))
    }
  }

  async handleScraperWizard(): Promise<void> {
    const progress = this.progressCheckpointManager.getProcessingProgress()

    if (progress.total > 0) {
      await this.promptUserForCheckpointAction()
    }

    await this.executeFullScrapingFlow()
  }

  async handleSearchWizard(): Promise<void> {
    const searchQuery = await this.promptForSearchQuery()
    const searchMode = await this.promptForSearchMode()
    const ripgrepSearchOptions = {
      pattern: searchQuery,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    }

    logger.info(`Searching for: "${searchQuery}" (mode: ${searchMode})\n`)

    try {
      const vectorEnabledModes = ['vector', 'auto', 'rag']
      if (vectorEnabledModes.includes(searchMode)) {
        await this.ensureVectorSearchIsAvailable(searchMode)
      }

      await this.conversationSearchOrchestrator.search(searchQuery, searchMode as 'auto' | 'vector' | 'rg' | 'rag', ripgrepSearchOptions)
    } catch (_error) {
      if (_error instanceof Error) {
        logger.error(_error.message)
      }
    }
  }

  async handleVectorizeWizard(): Promise<void> {
    const shouldRebuildIndex = await confirm({
      message: 'Rebuild the vector index from exports now?',
      default: true,
    })

    if (!shouldRebuildIndex) {
      logger.info('Vectorization cancelled.')
      return
    }

    try {
      await this.conversationSearchOrchestrator.validateVectorSearch()
    } catch (_error) {
      await this.handleVectorSearchValidationRetry(_error)
      return
    }

    await this.conversationSearchOrchestrator.vectorizeNow()
  }

  async handleDataReset(): Promise<void> {
    const isUserCertainOfReset = await confirm({
      message:
        '⚠️  This will delete all stored checkpoints, authentication data, and vector index. Are you sure?',
      default: false,
    })

    if (!isUserCertainOfReset) {
      logger.info('Reset cancelled.')
      return
    }

    try {
      this.wipeStorageDirectory()
      this.progressCheckpointManager.resetCheckpoint()
      logger.success('✅ Storage folder deleted. All progress has been reset.')
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      throw new CommandHandler.ResetError(`Failed to reset: ${errorMessage}`)
    }
  }

  handleShowHelp(): void {
    showHelp()
  }

  private async executeFullScrapingFlow(): Promise<void> {
    const browserManager = new BrowserManager()

    try {
      const activePage = await browserManager.launch()

      if (!this.progressCheckpointManager.isDiscoveryPhaseComplete()) {
        await this.runDiscoveryPhase(activePage)
      }

      const pendingConversations = this.progressCheckpointManager.getPendingConversations()

      if (pendingConversations.length === 0) {
        logger.success('All conversations already processed!')
        return
      }

      await this.runExtractionPhase(browserManager, pendingConversations)

      logger.success('\n✨ Export complete!')
    } catch (_error) {
      throw new CommandHandler.ScraperError(
        `Scraping failed: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    } finally {
      await browserManager.close()
    }
  }

  private async runDiscoveryPhase(page: any): Promise<void> {
    logger.info('\n=== Phase 1: Library Discovery ===\n')
    const libraryDiscoveryTool = new LibraryDiscovery()
    const discoveredConversations = await libraryDiscoveryTool.discoverAllConversationsFromLibrary(page)
    this.progressCheckpointManager.setDiscoveredConversations(discoveredConversations)
  }

  private async runExtractionPhase(browserManager: BrowserManager, pending: any[]): Promise<void> {
    logger.info(`\n=== Phase 2: Parallel Extraction (${pending.length} pending) ===\n`)

    const activeBrowser = browserManager.browserInstance
    if (!activeBrowser) {
      throw new CommandHandler.ScraperError('Browser was not initialized')
    }

    const workerPool = new WorkerPool(this.progressCheckpointManager, activeBrowser)
    await workerPool.initialize()
    await workerPool.processConversations(pending)
    await workerPool.close()
  }

  private async promptUserForCheckpointAction(): Promise<void> {
    const progress = this.progressCheckpointManager.getProcessingProgress()

    const chosenAction = await select({
      message: `Found checkpoint (${progress.processed}/${progress.total} processed). What do you want to do?`,
      choices: [
        { name: 'Resume from checkpoint', value: 'resume' },
        { name: 'Restart from scratch', value: 'restart' },
        { name: 'Cancel', value: 'cancel' },
      ],
    })

    if (chosenAction === 'cancel') {
      logger.info('Start cancelled.')
      process.exit(0)
    }

    if (chosenAction === 'restart') {
      this.progressCheckpointManager.resetCheckpoint()
    }
  }

  private async promptForSearchQuery(): Promise<string> {
    return input({
      message: 'Search query:',
      validate: (inputValue) => (inputValue.trim().length === 0 ? 'Please enter a query.' : true),
    })
  }

  private async promptForSearchMode(): Promise<string> {
    return select({
      message: 'Search mode:',
      choices: [
        { name: 'Auto (semantic for long queries, exact for short)', value: 'auto' },
        { name: 'Semantic (Ollama + Vectra)', value: 'vector' },
        { name: 'RAG (Ask history with Ollama)', value: 'rag' },
        { name: 'Exact text (ripgrep)', value: 'rg' },
      ],
      default: 'auto',
    })
  }

  private async ensureVectorSearchIsAvailable(mode: string): Promise<void> {
    if (mode === 'rg') return

    try {
      await this.conversationSearchOrchestrator.validateVectorSearch()
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(errorMessage)
      logger.info('Start Ollama with the embedding model, then run "vectorize".')
      throw new CommandHandler.ValidationError(errorMessage)
    }
  }

  private async handleVectorSearchValidationRetry(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(errorMessage)

    const shouldRetry = await confirm({
      message:
        'Ollama validation failed. Start Ollama (with the embedding model) and retry vectorization?',
      default: false,
    })

    if (!shouldRetry) {
      return
    }

    try {
      await this.conversationSearchOrchestrator.validateVectorSearch()
    } catch (err) {
      const nestedErrorMessage = err instanceof Error ? err.message : String(err)
      logger.error(nestedErrorMessage)
      return
    }

    await this.conversationSearchOrchestrator.vectorizeNow()
  }

  private wipeStorageDirectory(): void {
    const configuredAuthPath = config.authStoragePath
    const storageRootDirectory = configuredAuthPath ? configuredAuthPath.split('/')[0] : '.storage'
    try {
      rmSync(storageRootDirectory!, { recursive: true, force: true })
      logger.debug(`Deleted storage folder: ${storageRootDirectory}`)
    } catch (_error) {
      if ((_error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw _error
      }
    }
  }
}
