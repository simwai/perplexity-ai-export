import type { Browser, BrowserContext } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
import { ConversationExtractor, type ExtractedConversation } from './conversation-extractor.js'
import { FileWriter } from '../export/file-writer.js'
import type { CheckpointManager, ConversationMetadata } from './checkpoint-manager.js'

interface Worker {
  id: number
  extractor: ConversationExtractor
  isBusy: boolean
}

interface ProcessingStats {
  total: number
  succeeded: number
  failed: number
  skipped: number
  failures: Array<{ url: string; title: string; reason: string }>
}

function loadPersistedAuthenticationState(): any | null {
  const authenticationStoragePath = config.authStoragePath
  if (!existsSync(authenticationStoragePath)) return null
  try {
    const fileStats = statSync(authenticationStoragePath)
    const fileAgeInMilliseconds = Date.now() - fileStats.mtimeMs
    const twentyFourHoursInMilliseconds = 24 * 60 * 60 * 1000
    if (fileAgeInMilliseconds >= twentyFourHoursInMilliseconds) return null
    return JSON.parse(readFileSync(authenticationStoragePath, 'utf-8'))
  } catch (_error) {
    return null
  }
}

export class WorkerPool {
  static readonly InitializationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkerInitializationError'
    }
  }

  static readonly ProcessingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkerProcessingError'
    }
  }

  static readonly FileValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileValidationError'
    }
  }

  static readonly ExtractionError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ExtractionError'
    }
  }

  private activeWorkers: Worker[] = []
  private readonly conversationFileWriter: FileWriter
  private readonly progressCheckpointManager: CheckpointManager
  private processingStats: ProcessingStats
  private sharedBrowserContext: BrowserContext | null = null
  private contextRecreationLock: Promise<void> | null = null
  private browserInstance: Browser

  constructor(checkpointManager: CheckpointManager, browser: Browser) {
    this.conversationFileWriter = new FileWriter()
    this.progressCheckpointManager = checkpointManager
    this.processingStats = this.createInitialStats()
    this.browserInstance = browser
  }

  async initialize(): Promise<void> {
    logger.info(`Initializing worker pool with ${config.parallelWorkers} workers...`)

    try {
      await this.recreateSharedBrowserContext()

      for (let i = 0; i < config.parallelWorkers; i++) {
        const worker = await this.createNewWorker(i + 1)
        this.activeWorkers.push(worker)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      throw new WorkerPool.InitializationError(`Failed to initialize workers: ${errorMessage}`)
    }

    logger.success(`Worker pool ready with ${this.activeWorkers.length} workers`)
  }

  async processConversations(conversations: ConversationMetadata[]): Promise<void> {
    this.resetProcessingStats(conversations.length)
    logger.info(`Processing ${conversations.length} conversations in parallel...`)

    const conversationQueue = [...conversations]
    const workerLoops = this.activeWorkers.map((worker) =>
      this.runWorkerTaskLoop(worker, conversationQueue)
    )

    await Promise.all(workerLoops)
    this.displayProcessingSummary()
  }

  async close(): Promise<void> {
    if (this.sharedBrowserContext) {
      await this.sharedBrowserContext.close()
    }
    logger.info('Worker pool closed')
  }

  private async recreateSharedBrowserContext(): Promise<void> {
    if (this.contextRecreationLock) {
      await this.contextRecreationLock
      return
    }

    let resolveContextLock: () => void
    this.contextRecreationLock = new Promise<void>((resolve) => {
      resolveContextLock = resolve
    })

    try {
      if (this.sharedBrowserContext) {
        await this.sharedBrowserContext.close().catch(() => {})
      }

      const authenticationState = loadPersistedAuthenticationState()
      this.sharedBrowserContext = authenticationState
        ? await this.browserInstance.newContext({ storageState: authenticationState })
        : await this.browserInstance.newContext()

      logger.info('Shared browser context recreated')
    } finally {
      resolveContextLock!()
      this.contextRecreationLock = null
    }
  }

  private async createNewWorker(workerId: number): Promise<Worker> {
    if (!this.sharedBrowserContext) {
      throw new WorkerPool.InitializationError('Shared context not initialized')
    }

    const conversationExtractor = new ConversationExtractor(this.sharedBrowserContext)

    return {
      id: workerId,
      extractor: conversationExtractor,
      isBusy: false,
    }
  }

  private createInitialStats(): ProcessingStats {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    }
  }

  private resetProcessingStats(totalCount: number): void {
    this.processingStats = {
      total: totalCount,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    }
  }

  private async runWorkerTaskLoop(worker: Worker, queue: ConversationMetadata[]): Promise<void> {
    while (queue.length > 0) {
      const conversation = queue.shift()
      if (!conversation) break

      await this.processSingleConversation(worker, conversation)
    }
    logger.debug(`Worker ${worker.id} finished (queue empty)`)
  }

  private async processSingleConversation(
    worker: Worker,
    conversation: ConversationMetadata
  ): Promise<void> {
    worker.isBusy = true

    try {
      await this.introduceRandomAntiScrapingDelay()
      this.logConversationProcessingStart(worker, conversation)

      let extractedData: ExtractedConversation | null = null
      let hasAttemptedContextRecreation = false

      while (true) {
        try {
          extractedData = await worker.extractor.extract(conversation.url)
          break
        } catch (_error) {
          const isDeadContext = this.checkIfErrorIsDueToDeadContext(_error)
          if (isDeadContext && !hasAttemptedContextRecreation) {
            logger.warn(`Worker ${worker.id}: context error, attempting to recreate...`)
            await this.recreateSharedBrowserContext()
            worker.extractor = new ConversationExtractor(this.sharedBrowserContext!)
            hasAttemptedContextRecreation = true
          } else {
            throw _error
          }
        }
      }

      if (!extractedData) {
        this.handleConversationSkipped(
          worker,
          conversation,
          'No extractable content (empty thread or auth issue)'
        )
        return
      }

      const savedFilePath = this.conversationFileWriter.write(extractedData)
      await this.verifySavedMarkdownFile(savedFilePath, extractedData)

      this.logConversationProcessingSuccess(worker, savedFilePath)
      this.processingStats.succeeded++
      this.progressCheckpointManager.markProcessed(conversation.url)
    } catch (_error) {
      this.handleConversationProcessingError(worker, conversation, _error)
    } finally {
      worker.isBusy = false
    }
  }

  private checkIfErrorIsDueToDeadContext(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return (
      errorMessage.includes('Target page, context or browser has been closed') ||
      errorMessage.includes('Failed to open a new tab') ||
      errorMessage.includes('Protocol error') ||
      errorMessage.includes('browserContext.newPage')
    )
  }

  private async introduceRandomAntiScrapingDelay(): Promise<void> {
    const baseDelayInMs = 1000
    const randomJitterInMs = Math.random() * 2000
    await new Promise((resolve) => setTimeout(resolve, baseDelayInMs + randomJitterInMs))
  }

  private logConversationProcessingStart(worker: Worker, conversation: ConversationMetadata): void {
    const truncatedTitle = conversation.title.substring(0, 80)
    logger.info(`Worker ${worker.id} → ${truncatedTitle} (${conversation.url})`)
  }

  private logConversationProcessingSuccess(worker: Worker, filepath: string): void {
    logger.success(`Worker ${worker.id} saved: ${filepath}`)
  }

  private async verifySavedMarkdownFile(
    filepath: string,
    extracted: ExtractedConversation
  ): Promise<void> {
    const validationErrorMessage = this.performFileIntegrityChecks(filepath, extracted)
    if (validationErrorMessage) {
      throw new WorkerPool.FileValidationError(validationErrorMessage)
    }
  }

  private performFileIntegrityChecks(
    filepath: string,
    extracted: ExtractedConversation
  ): string | null {
    try {
      if (!existsSync(filepath)) {
        return 'File not found after write'
      }

      const fileStats = statSync(filepath)
      if (fileStats.size === 0) {
        return 'File is empty'
      }

      if (fileStats.size < 50) {
        return `File too small (${fileStats.size} bytes)`
      }

      const fileContent = readFileSync(filepath, 'utf-8')

      if (!fileContent.includes('##')) {
        return 'Missing question headers (##)'
      }

      if (!fileContent.includes('---')) {
        return 'Missing separators (---)'
      }

      if (!fileContent.includes(`# ${extracted.title}`)) {
        return 'Title not found in file content'
      }

      return null
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      return `Validation exception: ${errorMessage}`
    }
  }

  private handleConversationSkipped(
    worker: Worker,
    conversation: ConversationMetadata,
    reason: string
  ): void {
    logger.warn(`Worker ${worker.id} skipped: ${conversation.title} (${reason})`)
    this.processingStats.skipped++
    this.processingStats.failures.push({
      url: conversation.url,
      title: conversation.title,
      reason,
    })
  }

  private handleConversationProcessingError(
    worker: Worker,
    conversation: ConversationMetadata,
    error: unknown
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Worker ${worker.id} failed for ${conversation.title}`)
    logger.error(`  URL: ${conversation.url}`)
    logger.error(`  Error: ${errorMessage}`)

    this.processingStats.failed++
    this.processingStats.failures.push({
      url: conversation.url,
      title: conversation.title,
      reason: errorMessage,
    })
  }

  private displayProcessingSummary(): void {
    const horizontalLine = '='.repeat(70)
    logger.info(`\n${horizontalLine}`)
    logger.info('📊 EXPORT SUMMARY')
    logger.info(horizontalLine)

    logger.info(`Total conversations: ${this.processingStats.total}`)
    logger.success(`✓ Successfully exported: ${this.processingStats.succeeded}`)

    if (this.processingStats.skipped > 0) {
      logger.warn(`⚠ Skipped (no extractable content): ${this.processingStats.skipped}`)
    }

    if (this.processingStats.failed > 0) {
      logger.error(`✗ Failed: ${this.processingStats.failed}`)
    }

    if (this.processingStats.failures.length > 0) {
      logger.info('\n❌ Failed / Skipped Conversations:')
      logger.info('-'.repeat(70))
      for (const failure of this.processingStats.failures) {
        logger.error(`\n  ${failure.title}`)
        logger.error(`    URL: ${failure.url}`)
        logger.error(`    Reason: ${failure.reason}`)
      }
      logger.info()
    }

    logger.info(`${horizontalLine}\n`)

    if (this.processingStats.failed > 0 || this.processingStats.skipped > 0) {
      logger.info('💡 Failed/skipped conversations were NOT marked as processed.')
      logger.info('   You can rerun the scraper to retry them.')
    }
  }
}
