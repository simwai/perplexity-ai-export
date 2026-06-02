import { errorBus } from '../utils/error-bus.js'
import { type Browser, type BrowserContext } from 'patchright'
import { ConversationExtractor } from './conversation-extractor.js'
import { CheckpointManager, type ConversationMeta } from './checkpoint-manager.js'
import { FileWriter } from '../export/file-writer.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'
import pLimit from 'p-limit'

const MAX_RETRIES = 2

interface ExtractionWorker {
  id: number
  extractor: ConversationExtractor
  isBusy: boolean
}

interface QueueItem {
  meta: ConversationMeta
  attempts: number
}

export class WorkerPool {
  private readonly workers: ExtractionWorker[] = []
  private readonly fileWriter: FileWriter
  private sharedBrowserContext: BrowserContext | null = null
  private isRefreshing = false

  constructor(
    private readonly config: Config,
    private readonly checkpointManager: CheckpointManager,
    private readonly browser: Browser
  ) {
    this.fileWriter = new FileWriter(config)
  }

  async initialize(): Promise<void> {
    try {
      this.sharedBrowserContext = await this.browser.newContext({
        storageState: this.config.authStoragePath,
      })
      for (let i = 0; i < this.config.parallelWorkers; i++) {
        this.workers.push({
          id: i,
          extractor: new ConversationExtractor(this.config, this.sharedBrowserContext),
          isBusy: false,
        })
      }
    } catch (error) {
      errorBus.raiseError('Failed to initialize worker pool', error)
    }
  }

  async processConversations(conversationsToProcess: ConversationMeta[]): Promise<void> {
    const limit = pLimit(this.config.parallelWorkers)
    const queue: QueueItem[] = conversationsToProcess.map((meta) => ({ meta, attempts: 0 }))

    const tasks = queue.map((item) => limit(() => this.runWithRetry(item)))
    await Promise.all(tasks)

    const failedCount = conversationsToProcess.length - this.checkpointManager.getProcessingProgress().processed
    if (failedCount > 0) {
      logger.warn(`${failedCount} conversation(s) failed and will be retried on next run.`)
    }
  }

  private async runWithRetry(item: QueueItem): Promise<void> {
    const worker = this.getAvailableWorker()
    worker.isBusy = true
    try {
      await this.runExtraction(worker, item)
    } finally {
      worker.isBusy = false
    }
  }

  private getAvailableWorker(): ExtractionWorker {
    const worker = this.workers.find(w => !w.isBusy)
    if (worker) return worker
    return this.workers[0]!
  }

  async close(): Promise<void> {
    await this.sharedBrowserContext?.close().catch(() => {})
  }

  private async runExtraction(worker: ExtractionWorker, item: QueueItem): Promise<void> {
    try {
      const result = await worker.extractor.extract(item.meta.url)
      await this.handleSuccess(worker, item.meta, result)
    } catch (error) {
      await this.handleFailure(worker, item, error)
    }
  }

  private async handleSuccess(
    worker: ExtractionWorker,
    meta: ConversationMeta,
    result: any
  ): Promise<void> {
    const existingHash = this.checkpointManager.getContentHash(meta.id)
    const { processed, total } = this.checkpointManager.getProcessingProgress()
    const progressLabel = `[${processed}/${total}]`

    if (existingHash && existingHash === result.contentHash) {
      this.checkpointManager.markAsProcessed(meta.id)
      logger.info(`${progressLabel} Up to date: ${result.title} (skipped write)`)
    } else {
      await this.fileWriter.write(result)
      this.checkpointManager.markAsProcessed(meta.id, result.contentHash)
      logger.info(`${progressLabel} Processed: ${result.title}`)
    }

    worker.extractor.recoverTimeout()
  }

  private async handleFailure(
    worker: ExtractionWorker,
    item: QueueItem,
    error: unknown
  ): Promise<void> {
    const msg = error instanceof Error ? error.message : String(error)
    const isTimeout = msg.includes('API response timeout')
    const isContextLost = msg.includes('context is no longer available') || msg.includes('Target page, context or browser has been closed')

    if (isTimeout) worker.extractor.reduceTimeout()
    if (isContextLost) await this.refreshContext()

    if (item.attempts < MAX_RETRIES) {
      item.attempts++
      logger.warn(`Retrying ${item.meta.url} (attempt ${item.attempts}/${MAX_RETRIES})...`)
      await this.runWithRetry(item)
    } else {
      errorBus.emitError(`Failed to process ${item.meta.url} after ${MAX_RETRIES} retries`, error)
    }
  }

  private async refreshContext(): Promise<void> {
    if (this.isRefreshing) return
    this.isRefreshing = true
    try {
      await this.sharedBrowserContext?.close().catch(() => {})
      this.sharedBrowserContext = await this.browser.newContext({
        storageState: this.config.authStoragePath,
      })
      for (const worker of this.workers) {
        worker.extractor = new ConversationExtractor(this.config, this.sharedBrowserContext)
      }
    } catch (error) {
      errorBus.emitError('Failed to refresh worker context', error)
    } finally {
      this.isRefreshing = false
    }
  }
}
