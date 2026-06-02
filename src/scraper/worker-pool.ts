import { errorBus } from '../utils/error-bus.js'
import { type Browser, type BrowserContext } from 'patchright'
import { ConversationExtractor } from './conversation-extractor.js'
import { CheckpointManager, type ConversationMeta } from './checkpoint-manager.js'
import { FileWriter } from '../export/file-writer.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'
import pLimit from 'p-limit'

const MAXIMUM_RETRY_ATTEMPTS = 2

interface ExtractionWorker {
  workerId: number
  conversationExtractor: ConversationExtractor
  isCurrentlyBusy: boolean
}

interface ExtractionQueueItem {
  conversationMetadata: ConversationMeta
  currentAttemptCount: number
}

export class WorkerPool {
  private readonly activeWorkers: ExtractionWorker[] = []
  private readonly conversationFileWriter: FileWriter
  private sharedBrowserContext: BrowserContext | null = null
  private isContextRefreshingInProgress = false

  constructor(
    private readonly applicationConfig: Config,
    private readonly checkpointManager: CheckpointManager,
    private readonly browserInstance: Browser
  ) {
    this.conversationFileWriter = new FileWriter(applicationConfig)
  }

  async initialize(): Promise<void> {
    try {
      this.sharedBrowserContext = await this.browserInstance.newContext({
        storageState: this.applicationConfig.authStoragePath,
      })
      for (let workerIndex = 0; workerIndex < this.applicationConfig.parallelWorkers; workerIndex++) {
        this.activeWorkers.push({
          workerId: workerIndex,
          conversationExtractor: new ConversationExtractor(this.applicationConfig, this.sharedBrowserContext),
          isCurrentlyBusy: false,
        })
      }
    } catch (initializationError) {
      errorBus.raiseError('Failed to initialize worker pool', initializationError)
    }
  }

  async processConversations(conversationsToProcess: ConversationMeta[]): Promise<void> {
    const concurrencyLimiter = pLimit(this.applicationConfig.parallelWorkers)
    const extractionQueue: ExtractionQueueItem[] = conversationsToProcess.map((metadata) => ({
      conversationMetadata: metadata,
      currentAttemptCount: 0
    }))

    const extractionTasks = extractionQueue.map((queueItem) =>
      concurrencyLimiter(() => this.executeExtractionWithRetryLogic(queueItem))
    )

    await Promise.all(extractionTasks)

    const totalConversationsRequested = conversationsToProcess.length
    const totalConversationsProcessed = this.checkpointManager.getProcessingProgress().processed
    const failedConversationsCount = totalConversationsRequested - totalConversationsProcessed

    if (failedConversationsCount > 0) {
      logger.warn(`${failedConversationsCount} conversation(s) failed and will be retried on next run.`)
    }
  }

  private async executeExtractionWithRetryLogic(queueItem: ExtractionQueueItem): Promise<void> {
    const availableWorker = this.findAvailableWorker()
    availableWorker.isCurrentlyBusy = true
    try {
      await this.performConversationExtraction(availableWorker, queueItem)
    } finally {
      availableWorker.isCurrentlyBusy = false
    }
  }

  private findAvailableWorker(): ExtractionWorker {
    const worker = this.activeWorkers.find(w => !w.isCurrentlyBusy)
    if (worker) return worker
    // Fallback to first worker if none are marked free (should not happen with p-limit)
    return this.activeWorkers[0]!
  }

  async close(): Promise<void> {
    await this.sharedBrowserContext?.close().catch(() => {})
  }

  private async performConversationExtraction(worker: ExtractionWorker, queueItem: ExtractionQueueItem): Promise<void> {
    try {
      const extractionResult = await worker.conversationExtractor.extract(queueItem.conversationMetadata.url)
      await this.handleExtractionSuccess(worker, queueItem.conversationMetadata, extractionResult)
    } catch (extractionError) {
      await this.handleExtractionFailure(worker, queueItem, extractionError)
    }
  }

  private async handleExtractionSuccess(
    worker: ExtractionWorker,
    conversationMetadata: ConversationMeta,
    extractionResult: any
  ): Promise<void> {
    const existingContentHash = this.checkpointManager.getContentHash(conversationMetadata.id)
    const currentProgress = this.checkpointManager.getProcessingProgress()
    const progressStatusLabel = `[${currentProgress.processed}/${currentProgress.total}]`

    const isContentUnchanged = existingContentHash && existingContentHash === extractionResult.contentIntegrityHash

    if (isContentUnchanged) {
      this.checkpointManager.markAsProcessed(conversationMetadata.id)
      logger.info(`${progressStatusLabel} Up to date: ${extractionResult.conversationTitle} (skipped write)`)
    } else {
      await this.conversationFileWriter.write(extractionResult)
      this.checkpointManager.markAsProcessed(conversationMetadata.id, extractionResult.contentIntegrityHash)
      logger.info(`${progressStatusLabel} Processed: ${extractionResult.conversationTitle}`)
    }

    worker.conversationExtractor.recoverTimeout()
  }

  private async handleExtractionFailure(
    worker: ExtractionWorker,
    queueItem: ExtractionQueueItem,
    errorObject: unknown
  ): Promise<void> {
    const errorMessage = errorObject instanceof Error ? errorObject.message : String(errorObject)
    const isTimeoutError = errorMessage.includes('API response timeout')
    const isBrowserContextLost = errorMessage.includes('context is no longer available') ||
                               errorMessage.includes('Target page, context or browser has been closed')

    if (isTimeoutError) {
      worker.conversationExtractor.reduceTimeout()
    }

    if (isBrowserContextLost) {
      await this.refreshSharedBrowserContext()
    }

    const canRetry = queueItem.currentAttemptCount < MAXIMUM_RETRY_ATTEMPTS
    if (canRetry) {
      queueItem.currentAttemptCount++
      logger.warn(`Retrying ${queueItem.conversationMetadata.url} (attempt ${queueItem.currentAttemptCount}/${MAXIMUM_RETRY_ATTEMPTS})...`)
      await this.executeExtractionWithRetryLogic(queueItem)
    } else {
      errorBus.emitError(`Failed to process ${queueItem.conversationMetadata.url} after ${MAXIMUM_RETRY_ATTEMPTS} retries`, errorObject)
    }
  }

  private async refreshSharedBrowserContext(): Promise<void> {
    if (this.isContextRefreshingInProgress) return
    this.isContextRefreshingInProgress = true
    try {
      await this.sharedBrowserContext?.close().catch(() => {})
      this.sharedBrowserContext = await this.browserInstance.newContext({
        storageState: this.applicationConfig.authStoragePath,
      })
      for (const worker of this.activeWorkers) {
        worker.conversationExtractor = new ConversationExtractor(this.applicationConfig, this.sharedBrowserContext)
      }
    } catch (refreshError) {
      errorBus.emitError('Failed to refresh worker context', refreshError)
    } finally {
      this.isContextRefreshingInProgress = false
    }
  }
}
