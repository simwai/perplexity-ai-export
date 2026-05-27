import { errorBus } from '../utils/error-bus.js'
import { type Browser, type BrowserContext } from '@playwright/test'
import { ConversationExtractor } from './conversation-extractor.js'
import { CheckpointManager, type ConversationMeta } from './checkpoint-manager.js'
import { FileWriter } from '../export/file-writer.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'

interface ExtractionWorker {
  id: number
  extractor: ConversationExtractor
  isBusy: boolean
}

export class WorkerPool {
  private workers: ExtractionWorker[] = []
  private checkpointManager: CheckpointManager
  private browser: Browser
  private fileWriter: FileWriter
  private sharedBrowserContext: BrowserContext | null = null
  private config: Config

  constructor(config: Config, checkpointManager: CheckpointManager, browser: Browser) {
    this.config = config
    this.checkpointManager = checkpointManager
    this.browser = browser
    this.fileWriter = new FileWriter(config)
  }

  async initialize(): Promise<void> {
    try {
      this.sharedBrowserContext = await this.browser.newContext()
      for (let i = 0; i < this.config.parallelWorkers; i++) {
        const conversationExtractor = new ConversationExtractor(
          this.config,
          this.sharedBrowserContext
        )
        this.workers.push({
          id: i,
          extractor: conversationExtractor,
          isBusy: false,
        })
      }
    } catch (_error) {
      errorBus.emitError('Failed to initialize worker pool', _error)
      throw _error
    }
  }

  async processConversations(conversations: ConversationMeta[]): Promise<void> {
    const queue = [...conversations]
    const activeTasks: Promise<void>[] = []

    while (queue.length > 0 || activeTasks.length > 0) {
      const availableWorker = this.workers.find((w) => !w.isBusy)

      if (availableWorker && queue.length > 0) {
        const conversation = queue.shift()!
        availableWorker.isBusy = true

        const task = (async () => {
          try {
            const result = await availableWorker.extractor.extract(conversation.url)
            const existingHash = this.checkpointManager.getContentHash(conversation.id)

            if (existingHash && existingHash === result.contentHash) {
              this.checkpointManager.markAsProcessed(conversation.id)
              const progress = this.checkpointManager.getProcessingProgress()
              logger.info(
                `[${progress.processed}/${progress.total}] Up to date: ${result.title} (skipped write)`
              )
            } else {
              await this.fileWriter.write(result)
              this.checkpointManager.markAsProcessed(conversation.id, result.contentHash)
              const progress = this.checkpointManager.getProcessingProgress()
              logger.info(`[${progress.processed}/${progress.total}] Processed: ${result.title}`)
            }
          } catch (_error) {
            errorBus.emitError(`Failed to process ${conversation.url}`, _error)

            // If the context is dead, we need to refresh the pool
            if (
              _error instanceof Error &&
              _error.message.includes('context is no longer available')
            ) {
              logger.warn('Browser context lost. Refreshing worker context...')
              await this.refreshContext()
            }
          } finally {
            availableWorker.isBusy = false
          }
        })()

        activeTasks.push(task)
        // Clean up completed tasks
        task.finally(() => {
          const index = activeTasks.indexOf(task)
          if (index > -1) activeTasks.splice(index, 1)
        })
      } else {
        // Wait for a worker to become available
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  async close(): Promise<void> {
    if (this.sharedBrowserContext) {
      await this.sharedBrowserContext.close().catch(() => {})
    }
  }

  private async refreshContext(): Promise<void> {
    try {
      if (this.sharedBrowserContext) {
        await this.sharedBrowserContext.close().catch(() => {})
      }
      this.sharedBrowserContext = await this.browser.newContext()
      for (const worker of this.workers) {
        worker.extractor = new ConversationExtractor(this.config, this.sharedBrowserContext!)
      }
    } catch (_error) {
      errorBus.emitError('Failed to refresh worker context', _error)
    }
  }
}
