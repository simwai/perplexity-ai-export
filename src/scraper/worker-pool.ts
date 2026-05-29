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
  private readonly workers: ExtractionWorker[] = []
  private readonly fileWriter: FileWriter
  private sharedBrowserContext: BrowserContext | null = null

  constructor(
    private readonly config: Config,
    private readonly checkpointManager: CheckpointManager,
    private readonly browser: Browser
  ) {
    this.fileWriter = new FileWriter(config)
  }

  async initialize(): Promise<void> {
    try {
      this.sharedBrowserContext = await this.browser.newContext()

      const workerCount = this.config.parallelWorkers
      for (let i = 0; i < workerCount; i++) {
        const extractor = new ConversationExtractor(this.config, this.sharedBrowserContext)
        this.workers.push({
          id: i,
          extractor: extractor,
          isBusy: false,
        })
      }
    } catch (error) {
      errorBus.emitError('Failed to initialize worker pool', error)
      throw error
    }
  }

  async processConversations(conversationsToProcess: ConversationMeta[]): Promise<void> {
    const conversationQueue = [...conversationsToProcess]
    const activeExtractionTasks: Promise<void>[] = []

    while (conversationQueue.length > 0 || activeExtractionTasks.length > 0) {
      const availableWorker = this.workers.find((worker) => !worker.isBusy)

      const shouldStartNewTask = availableWorker && conversationQueue.length > 0
      if (shouldStartNewTask) {
        const conversationMetadata = conversationQueue.shift()!
        availableWorker.isBusy = true

        const extractionTask = (async () => {
          try {
            const extractionResult = await availableWorker.extractor.extract(
              conversationMetadata.url
            )
            const existingContentHash = this.checkpointManager.getContentHash(
              conversationMetadata.id
            )

            const isUpToDate =
              existingContentHash && existingContentHash === extractionResult.contentHash
            const currentProgress = this.checkpointManager.getProcessingProgress()
            const progressLabel = `[${currentProgress.processed}/${currentProgress.total}]`

            if (isUpToDate) {
              this.checkpointManager.markAsProcessed(conversationMetadata.id)
              logger.info(`${progressLabel} Up to date: ${extractionResult.title} (skipped write)`)
            } else {
              await this.fileWriter.write(extractionResult)
              this.checkpointManager.markAsProcessed(
                conversationMetadata.id,
                extractionResult.contentHash
              )
              logger.info(`${progressLabel} Processed: ${extractionResult.title}`)
            }
          } catch (error) {
            errorBus.emitError(`Failed to process ${conversationMetadata.url}`, error)

            const isContextLostError =
              error instanceof Error && error.message.includes('context is no longer available')
            if (isContextLostError) {
              logger.warn('Browser context lost. Refreshing worker context...')
              await this.refreshContext()
            }
          } finally {
            availableWorker.isBusy = false
          }
        })()

        activeExtractionTasks.push(extractionTask)

        extractionTask.finally(() => {
          const taskIndex = activeExtractionTasks.indexOf(extractionTask)
          const isTaskInList = taskIndex > -1
          if (isTaskInList) {
            activeExtractionTasks.splice(taskIndex, 1)
          }
        })
      } else {
        const POLLING_INTERVAL_MS = 100
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
      }
    }
  }

  async close(): Promise<void> {
    const isContextOpen = !!this.sharedBrowserContext
    if (isContextOpen) {
      await this.sharedBrowserContext!.close().catch(() => {
        // Silently handle close errors
      })
    }
  }

  private async refreshContext(): Promise<void> {
    try {
      const isContextOpen = !!this.sharedBrowserContext
      if (isContextOpen) {
        await this.sharedBrowserContext!.close().catch(() => {})
      }

      this.sharedBrowserContext = await this.browser.newContext()

      for (const worker of this.workers) {
        worker.extractor = new ConversationExtractor(this.config, this.sharedBrowserContext)
      }
    } catch (error) {
      errorBus.emitError('Failed to refresh worker context', error)
    }
  }
}
