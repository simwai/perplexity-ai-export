import { type Page } from '@playwright/test'
import { errorBus } from '../utils/error-bus.js'
import { input, select, confirm } from '@inquirer/prompts'
import { rmSync } from 'node:fs'
import { sep } from 'node:path'
import { BrowserManager } from '../scraper/browser.js'
import { CheckpointManager } from '../scraper/checkpoint-manager.js'
import { WorkerPool } from '../scraper/worker-pool.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { logger } from '../utils/logger.js'
import { showHelp } from './help.js'
import { LibraryDiscovery } from '../scraper/library-discovery.js'
import { type Config } from '../utils/config.js'

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

  private readonly checkpointManager: CheckpointManager
  private readonly searchOrchestrator: SearchOrchestrator

  constructor(private readonly config: Config) {
    this.checkpointManager = new CheckpointManager(config)
    this.searchOrchestrator = new SearchOrchestrator(config)
  }

  async handleStartLibraryExport(): Promise<void> {
    try {
      await this.executeFullScrapingFlow()
    } catch (error) {
      errorBus.emitError('Scraper failed', error)
      logger.info(
        '\nNote: Check "debug/api-diagnostics.jsonl" for details if the failure is related to API response changes.'
      )
    }
  }

  async handleScraperWizard(): Promise<void> {
    const progress = this.checkpointManager.getProcessingProgress()
    const hasExistingProgress = progress.total > 0

    if (hasExistingProgress) {
      await this.promptUserForCheckpointAction()
    }

    await this.executeFullScrapingFlow()
  }

  async handleSearchWizard(): Promise<void> {
    const query = await this.promptForSearchQuery()
    let mode = (await this.promptForSearchMode()) as 'auto' | 'vector' | 'rg' | 'rag'

    const ripgrepOptions = {
      pattern: query,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    }

    try {
      const isSemanticMode = mode === 'auto' || mode === 'vector' || mode === 'rag'
      if (isSemanticMode) {
        try {
          await this.searchOrchestrator.validateVectorSearch()
        } catch (error) {
          if (mode === 'auto') {
            logger.warn(
              'Ollama is not available (required for semantic features). Falling back to Exact Text search (ripgrep).'
            )
            mode = 'rg'
          } else {
            const errorMessage = error instanceof Error ? error.message : String(error)
            errorBus.emitError(errorMessage)
            logger.info('Start Ollama with the embedding model, then run "vectorize".')
            return
          }
        }
      }

      logger.info(`Searching for: "${query}" (mode: ${mode})\n`)
      await this.searchOrchestrator.search(query, mode, ripgrepOptions)
    } catch (error) {
      if (error instanceof Error) {
        errorBus.emitError(error.message, error)
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
      await this.searchOrchestrator.validateVectorSearch()
    } catch (error) {
      await this.handleVectorSearchValidationRetry(error)
      return
    }

    await this.searchOrchestrator.vectorizeNow()
  }

  async handleDataReset(): Promise<void> {
    const isCertainOfReset = await confirm({
      message:
        '⚠️  This will delete all stored checkpoints, authentication data, and vector index. Are you sure?',
      default: false,
    })

    if (!isCertainOfReset) {
      logger.info('Reset cancelled.')
      return
    }

    try {
      this.wipeStorageDirectory()
      this.checkpointManager.resetCheckpoint()
      logger.success('✅ Storage folder deleted. All progress has been reset.')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new CommandHandler.ResetError(`Failed to reset: ${errorMessage}`)
    }
  }

  handleShowHelp(): void {
    showHelp()
  }

  private async executeFullScrapingFlow(): Promise<void> {
    const browserManager = new BrowserManager(this.config)

    try {
      const activePage = await browserManager.launch()

      const isDiscoveryRequired = !this.checkpointManager.isDiscoveryPhaseComplete()
      if (isDiscoveryRequired) {
        await this.runDiscoveryPhase(activePage)
      }

      const pendingConversations = this.checkpointManager.getPendingConversations()
      const hasPendingConversations = pendingConversations.length > 0

      if (!hasPendingConversations) {
        logger.success('All conversations already processed!')
        return
      }

      await this.runExtractionPhase(browserManager, pendingConversations)

      logger.success('\n✨ Export complete!')
      logger.info(
        '\nNote: If some conversations were missed or the format looks wrong, please check "debug/api-diagnostics.jsonl" and consider opening a GitHub issue with that file attached.'
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new CommandHandler.ScraperError(`Scraping failed: ${errorMessage}`)
    } finally {
      await browserManager.close()
    }
  }

  private async runDiscoveryPhase(page: Page): Promise<void> {
    logger.info('\n=== Phase 1: Library Discovery ===\n')
    const discoveryTool = new LibraryDiscovery(this.config)
    const discoveredConversations = await discoveryTool.discoverAllConversationsFromLibrary(page)
    this.checkpointManager.setDiscoveredConversations(discoveredConversations)
  }

  private async runExtractionPhase(
    browserManager: BrowserManager,
    pendingConversations: any[]
  ): Promise<void> {
    logger.info(`\n=== Phase 2: Parallel Extraction (${pendingConversations.length} pending) ===\n`)

    const activeBrowser = browserManager.browserInstance
    if (!activeBrowser) {
      throw new CommandHandler.ScraperError('Browser was not initialized')
    }

    const workerPool = new WorkerPool(this.config, this.checkpointManager, activeBrowser)
    await workerPool.initialize()
    await workerPool.processConversations(pendingConversations)
    await workerPool.close()
  }

  private async promptUserForCheckpointAction(): Promise<void> {
    const currentProgress = this.checkpointManager.getProcessingProgress()

    const actionChoices = [
      { name: 'Resume (Continue processing known threads)', value: 'resume' },
      { name: 'Sync (Re-scan library for new threads and updates)', value: 'update' },
      { name: 'Start Over (Re-scan and re-process everything)', value: 'restart' },
      { name: 'Cancel', value: 'cancel' },
    ]

    const selectedAction = await select({
      message: `Found checkpoint (${currentProgress.processed}/${currentProgress.total} processed). What do you want to do?`,
      choices: actionChoices,
    })

    if (selectedAction === 'cancel') {
      logger.info('Start cancelled.')
      process.exit(0)
    }

    if (selectedAction === 'restart') {
      this.checkpointManager.resetCheckpoint()
    } else if (selectedAction === 'update') {
      this.checkpointManager.prepareForUpdateRun()
    }
  }

  private async promptForSearchQuery(): Promise<string> {
    return input({
      message: 'Search query:',
      validate: (value: string) => (value.trim().length === 0 ? 'Please enter a query.' : true),
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

  private async handleVectorSearchValidationRetry(validationError: unknown): Promise<void> {
    const validationErrorMessage =
      validationError instanceof Error ? validationError.message : String(validationError)
    errorBus.emitError(validationErrorMessage)

    const shouldRetryAfterStartingOllama = await confirm({
      message:
        'Ollama validation failed. Start Ollama (with the embedding model) and retry vectorization?',
      default: false,
    })

    if (!shouldRetryAfterStartingOllama) {
      return
    }

    try {
      await this.searchOrchestrator.validateVectorSearch()
    } catch (retryError) {
      const retryErrorMessage =
        retryError instanceof Error ? retryError.message : String(retryError)
      errorBus.emitError(retryErrorMessage)
      return
    }

    await this.searchOrchestrator.vectorizeNow()
  }

  private wipeStorageDirectory(): void {
    const authStoragePath = this.config.authStoragePath
    const storageRootDir = authStoragePath ? authStoragePath.split(sep)[0] : '.storage'

    try {
      const isDirectorySpecified = !!storageRootDir
      if (isDirectorySpecified) {
        rmSync(storageRootDir, { recursive: true, force: true })
        logger.debug(`Deleted storage folder: ${storageRootDir}`)
      }
    } catch (error) {
      const isNotFoundError = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isNotFoundError) {
        throw error
      }
    }
  }
}
