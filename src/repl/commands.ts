import { type Page } from '@playwright/test'
import { errorBus } from '../utils/error-bus.js'
import { input, select, confirm } from '@inquirer/prompts'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { BrowserManager } from '../scraper/browser.js'
import { CheckpointManager, type ConversationMeta } from '../scraper/checkpoint-manager.js'
import { WorkerPool } from '../scraper/worker-pool.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { RagOrchestrator } from '../ai/rag-orchestrator.js'
import { type ChatMessage } from '../ai/ai-client.js'
import { logger } from '../utils/logger.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createNamedError } from '../utils/errors.js'
import { ok, err, from, type Result } from 'super-result'
import { showHelp } from './help.js'
import { LibraryDiscovery } from '../scraper/library-discovery.js'
import { type Config } from '../utils/config.js'

export class CommandHandler {
  static readonly ScraperError = createNamedError('ScraperError')
  static readonly SearchError = createNamedError('SearchError')
  static readonly VectorizeError = createNamedError('VectorizeError')
  static readonly ValidationError = createNamedError('ValidationError')
  static readonly ResetError = createNamedError('ResetError')

  private readonly checkpointManager: CheckpointManager
  private readonly searchOrchestrator: SearchOrchestrator
  private readonly ragOrchestrator: RagOrchestrator

  constructor(private readonly config: Config) {
    this.checkpointManager = new CheckpointManager(config)
    this.searchOrchestrator = new SearchOrchestrator(config)
    this.ragOrchestrator = new RagOrchestrator(config)
  }

  private async ensureVectorSearchAvailable(mode: 'auto' | 'vector' | 'rag'): Promise<boolean> {
    const result = await this.searchOrchestrator.validateVectorSearch()
    if (result.ok) return true

    const errorMessage = errorMessageOf(result.error)
    errorBus.emitError(errorMessage)
    if (mode === 'auto') {
      logger.warn(
        'Ollama is not available (required for semantic features). Falling back to Exact Text search (ripgrep).'
      )
      return false
    }
    logger.info('Start Ollama with the embedding model, then run "vectorize".')
    return false
  }

  async handleStartLibraryExport(): Promise<void> {
    const result = await this.executeFullScrapingFlow()
    if (!result.ok) {
      errorBus.emitError('Scraper failed', result.error)
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

    const isSemanticMode = mode === 'auto' || mode === 'vector' || mode === 'rag'
    if (isSemanticMode) {
      const available = await this.ensureVectorSearchAvailable(mode)
      if (!available) return
    }

    logger.info(`Searching for: "${query}" (mode: ${mode})\n`)
    const searchResult = await this.searchOrchestrator.search(query, mode, ripgrepOptions)
    if (!searchResult.ok) {
      const errorMessage = errorMessageOf(searchResult.error)
      errorBus.emitError(errorMessage)
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

    const available = await this.ensureVectorSearchAvailable('vector')
    if (!available) return

    const result = await this.searchOrchestrator.vectorizeNow()
    if (!result.ok) {
      const errorMessage = errorMessageOf(result.error)
      errorBus.emitError(errorMessage)
    }
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

    const resetResult = await this.checkpointManager.resetCheckpoint()
    if (!resetResult.ok) {
      errorBus.emitError('Failed to reset', resetResult.error)
      return
    }

    this.wipeStorageDirectory()
    logger.success('✅ Storage folder deleted. All progress has been reset.')
  }

  handleShowHelp(): void {
    showHelp()
  }

  private async executeFullScrapingFlow(): Promise<Result<void, Error>> {
    const browserManager = new BrowserManager(this.config)

    const launchResult = await browserManager.launch()
    if (!launchResult.ok) {
      return err(new Error(`Failed to launch browser: ${errorMessageOf(launchResult.error)}`))
    }
    const activePage = launchResult.value

    const isDiscoveryRequired = !this.checkpointManager.isDiscoveryPhaseComplete()
    if (isDiscoveryRequired) {
      await this.runDiscoveryPhase(activePage)
    }

    const pendingConversations = this.checkpointManager.getPendingConversations()
    const hasPendingConversations = pendingConversations.length > 0

    if (!hasPendingConversations) {
      logger.success('All conversations already processed!')
      await browserManager.close()
      return ok(undefined)
    }

    await this.runExtractionPhase(browserManager, pendingConversations)

    logger.success('\n✨ Export complete!')
    logger.info(
      '\nNote: If some conversations were missed or the format looks wrong, please check "debug/api-diagnostics.jsonl" and consider opening a GitHub issue with that file attached.'
    )
    await browserManager.close()
    return ok(undefined)
  }

  private async runDiscoveryPhase(page: Page): Promise<void> {
    logger.info('\n=== Phase 1: Library Discovery ===\n')
    const discoveryTool = new LibraryDiscovery()
    const discoveredResult = await discoveryTool.discoverAllConversationsFromLibrary(page)
    if (!discoveredResult.ok) {
      errorBus.emitError('Failed to discover conversations', discoveredResult.error)
      return
    }
    const discoveredConversations = discoveredResult.value
    const setResult =
      await this.checkpointManager.setDiscoveredConversations(discoveredConversations)
    if (!setResult.ok) {
      errorBus.emitError('Failed to save discovered conversations', setResult.error)
    }
  }

  private async runExtractionPhase(
    browserManager: BrowserManager,
    pendingConversations: ConversationMeta[]
  ): Promise<void> {
    logger.info(`\n=== Phase 2: Parallel Extraction (${pendingConversations.length} pending) ===\n`)

    const activeBrowser = browserManager.getBrowserInstance()
    if (!activeBrowser) {
      errorBus.emitError('Browser was not initialized')
      return
    }

    const workerPool = new WorkerPool(this.config, this.checkpointManager, activeBrowser)
    const initResult = await workerPool.initialize()
    if (!initResult.ok) {
      errorBus.emitError('Failed to initialize worker pool', initResult.error)
      return
    }

    const processResult = await workerPool.processConversations(pendingConversations)
    if (!processResult.ok) {
      errorBus.emitError('Failed to process conversations', processResult.error)
    }

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
      await this.checkpointManager.resetCheckpoint()
    } else if (selectedAction === 'update') {
      await this.checkpointManager.prepareForUpdateRun()
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

  async handleChatWizard(): Promise<void> {
    const available = await this.ensureVectorSearchAvailable('rag')
    if (!available) return

    logger.info('\n💬 History Chat Mode')
    logger.info('Type your questions about your exported conversations.')
    logger.info('Type "exit" or "quit" to return to the main menu.\n')

    const history: ChatMessage[] = []
    let isChatting = true

    while (isChatting) {
      const queryResult = await from<string>(
        async () =>
          await input({
            message: 'chat>',
            validate: (value) => (value.trim().length === 0 ? 'Please enter a message.' : true),
          })
      )

      if (!queryResult.ok) {
        if (queryResult.error instanceof Error && queryResult.error.name === 'ExitPromptError') {
          isChatting = false
        } else {
          const errorMessage = errorMessageOf(queryResult.error)
          errorBus.emitError(errorMessage)
        }
        continue
      }

      const query = queryResult.value

      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        isChatting = false
        continue
      }

      const chatResult = await this.ragOrchestrator.chat(query, history)
      if (!chatResult.ok) {
        const errorMessage = errorMessageOf(chatResult.error)
        errorBus.emitError(errorMessage)
        continue
      }

      const response = chatResult.value

      logger.log('\nAssistant:\n')
      logger.log(response.content)
      logger.info(
        `\nTokens: ${response.usage.totalTokens} (${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion)\n`
      )

      history.push({ role: 'user', content: query })
      history.push({ role: 'assistant', content: response.content })

      if (history.length > this.MAX_HISTORY_MESSAGES) {
        history.splice(0, 2)
      }
    }
  }

  private readonly MAX_HISTORY_MESSAGES = 20

  private wipeStorageDirectory(): void {
    const authStoragePath = this.config.authStoragePath

    const resolvedAuthPath = resolve(authStoragePath)
    const storageRootDir = dirname(resolvedAuthPath)

    if (!storageRootDir.endsWith('.storage')) {
      errorBus.emitError(
        `Refusing to delete unexpected path: ${storageRootDir}. Expected a path ending with '.storage'`
      )
      return
    }

    const rmResult = from(() => deleteStorageFolder(storageRootDir))
    if (!rmResult.ok) {
      const isNotFoundError = (rmResult.error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isNotFoundError) {
        errorBus.emitError('Failed to wipe storage directory', rmResult.error)
      }
    }
  }
}

function deleteStorageFolder(storageRootDir: string): void {
  if (storageRootDir) {
    rmSync(storageRootDir, { recursive: true, force: true })
    logger.debug(`Deleted storage folder: ${storageRootDir}`)
  }
}
