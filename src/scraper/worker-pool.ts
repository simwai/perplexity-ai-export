import { errorBus } from '../utils/error-bus.js'
import { type Browser, type BrowserContext } from '@playwright/test'
import { ConversationExtractor } from './conversation-extractor.js'
import { CheckpointManager, type ConversationMeta } from './checkpoint-manager.js'
import { FileWriter } from '../export/file-writer.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'

const MAX_RETRIES = 2
const POLLING_INTERVAL_MS = 100

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
      errorBus.emitError('Failed to initialize worker pool', error)
      throw error
    }
  }

  async processConversations(conversationsToProcess: ConversationMeta[]): Promise<void> {
    const queue: QueueItem[] = conversationsToProcess.map((meta) => ({ meta, attempts: 0 }))
    const activeTasks: Promise<void>[] = []

    while (queue.length > 0 || activeTasks.length > 0) {
      const worker = this.workers.find((w) => !w.isBusy)

      if (worker && queue.length > 0) {
        const item = queue.shift()!
        worker.isBusy = true

        const task = this.runExtraction(worker, item, queue).finally(() => {
          worker.isBusy = false
          activeTasks.splice(activeTasks.indexOf(task), 1)
        })

        activeTasks.push(task)
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
      }
    }

    const failedCount =
      conversationsToProcess.length - this.checkpointManager.getProcessingProgress().processed
    if (failedCount > 0) {
      logger.warn(`${failedCount} conversation(s) failed and will be retried on next run.`)
    }
  }

  async close(): Promise<void> {
    await this.sharedBrowserContext?.close().catch(() => {})
  }

  private async runExtraction(
    worker: ExtractionWorker,
    item: QueueItem,
    queue: QueueItem[]
  ): Promise<void> {
    try {
      const result = await worker.extractor.extract(item.meta.url)
      await this.handleSuccess(worker, item.meta, result)
    } catch (error) {
      await this.handleFailure(worker, item, queue, error)
    }
  }

  private async handleSuccess(
    worker: ExtractionWorker,
    meta: ConversationMeta,
    result: Awaited<ReturnType<ConversationExtractor['extract']>>
  ): Promise<void> {
    const existingHash = this.checkpointManager.getContentHash(meta.id)
    const { processed, total } = this.checkpointManager.getProcessingProgress()
    const progressLabel = `[${processed}/${total}]`

    if (existingHash && existingHash === result.contentHash) {
      this.checkpointManager.markAsProcessed(meta.id)
      logger.info(`${progressLabel} Up to date: ${result.title} (skipped write)`)
    } else {
      this.fileWriter.write(result)
      this.checkpointManager.markAsProcessed(meta.id, result.contentHash)
      logger.info(`${progressLabel} Processed: ${result.title}`)
    }

    worker.extractor.recoverTimeout()
  }

  private async handleFailure(
    worker: ExtractionWorker,
    item: QueueItem,
    queue: QueueItem[],
    error: unknown
  ): Promise<void> {
    const isTimeout = error instanceof Error && error.message.includes('API response timeout')
    const isContextLost =
      error instanceof Error && error.message.includes('context is no longer available')

    if (isTimeout) worker.extractor.reduceTimeout()

    if (isContextLost) {
      logger.warn('Browser context lost. Refreshing worker context...')
      await this.refreshContext()
    }

    if (item.attempts < MAX_RETRIES) {
      item.attempts++
      logger.warn(`Retrying ${item.meta.url} (attempt ${item.attempts}/${MAX_RETRIES})...`)
      queue.push(item)
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
