import { errorBus } from '../utils/error-bus.js'
import { type Browser, type BrowserContext } from '@playwright/test'
import { ConversationExtractor, type ExtractedConversation } from './conversation-extractor.js'
import { CheckpointManager, type ConversationMeta } from './checkpoint-manager.js'
import { logger } from '../utils/logger.js'
import { type Config } from '../utils/config.js'
import { isTypedError } from '../utils/errors.js'
import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { sanitizeFilename, sanitizeSpaceName } from '../export/sanitizer.js'
import { createResult, ok, err, type Result } from 'super-result'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { RateLimiter } from './rate-limiter.js'

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
  private sharedBrowserContext: BrowserContext | null = null
  private isRefreshing = false
  private readonly rateLimiter: RateLimiter

  private readonly resultFactory = createResult<Error>((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  )

  constructor(
    private readonly config: Config,
    private readonly checkpointManager: CheckpointManager,
    private readonly browser: Browser
  ) {
    this.rateLimiter = new RateLimiter(this.config.extractionConcurrency)
  }

  async initialize(): Promise<Result<void, Error>> {
    return this.resultFactory.from(async () => await this.createWorkers())
  }

  private async createWorkers(): Promise<void> {
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
  }

  async processConversations(
    conversationsToProcess: ConversationMeta[]
  ): Promise<Result<void, Error>> {
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
    return ok(undefined)
  }

  async close(): Promise<void> {
    // best-effort teardown; if the context is already gone, Playwright throws and we ignore.
    try {
      await this.sharedBrowserContext?.close()
    } catch (closeError) {
      logger.debug('close: sharedBrowserContext.close failed', errorMessageOf(closeError))
    } finally {
      this.sharedBrowserContext = null
    }
  }

  private async runExtraction(
    worker: ExtractionWorker,
    item: QueueItem,
    queue: QueueItem[]
  ): Promise<void> {
    const extractResult = await worker.extractor.extract(item.meta.url, item.meta.id)
    if (!extractResult.ok) {
      await this.handleFailure(worker, item, queue, extractResult.error)
      return
    }
    await this.handleSuccess(worker, item.meta, extractResult)
  }

  private async handleSuccess(
    worker: ExtractionWorker,
    meta: ConversationMeta,
    result: Result<ExtractedConversation, Error>
  ): Promise<void> {
    const existingHash = this.checkpointManager.getContentHash(meta.id)
    const { processed, total } = this.checkpointManager.getProcessingProgress()
    const progressLabel = `[${processed}/${total}]`

    if (!result.ok) {
      errorBus.emitError('Extraction returned error', result.error)
      return
    }

    const conversation = result.value

    if (existingHash && existingHash === conversation.contentHash) {
      const markResult = await this.checkpointManager.markAsProcessed(meta.id)
      if (!markResult.ok) errorBus.emitError('Failed to mark as processed', markResult.error)
      logger.info(`${progressLabel} Up to date: ${conversation.title} (skipped write)`)
    } else {
      const writeResult = await this.writeConversationAsMarkdown(result)
      if (!writeResult.ok) {
        errorBus.emitError('Failed to write conversation', writeResult.error)
        return
      }
      const markResult = await this.checkpointManager.markAsProcessed(
        meta.id,
        conversation.contentHash
      )
      if (!markResult.ok) errorBus.emitError('Failed to mark as processed', markResult.error)
      logger.info(`${progressLabel} Processed: ${conversation.title}`)
    }

    worker.extractor.recoverTimeout()
  }

  private async writeConversationAsMarkdown(
    conversation: Result<ExtractedConversation, Error>
  ): Promise<Result<void, Error>> {
    if (!conversation.ok) return err(new Error('Missing conversation'))

    const data = conversation.value
    const outputDir = this.config.exportDir
    const safeSpaceName = sanitizeSpaceName(data.spaceName)
    const spaceSpecificDirectory = join(outputDir, safeSpaceName)

    if (!existsSync(spaceSpecificDirectory)) {
      const mkdirResult = this.resultFactory.from(() =>
        mkdirSync(spaceSpecificDirectory, { recursive: true })
      )
      if (!mkdirResult.ok)
        return err(new Error(`Failed to create directory: ${errorMessageOf(mkdirResult.error)}`))
    }

    const safeFileTitle = sanitizeFilename(data.title)
    const fileName = `${safeFileTitle} (${data.id}).md`
    const destinationFilePath = join(spaceSpecificDirectory, fileName)

    const headerTitle = `# ${data.title}\n\n`
    const metadataBlock =
      `**Space:** ${data.spaceName}  \n` +
      `**ID:** ${data.id}  \n` +
      `**Date:** ${data.timestamp.toISOString()}  \n\n`
    const content = headerTitle + metadataBlock + data.content

    const tmpPath = `${destinationFilePath}.tmp`
    const writeResult = this.resultFactory.from(() => writeFileSync(tmpPath, content, 'utf-8'))
    if (!writeResult.ok) return writeResult

    const fs = await import('node:fs')
    const renameResult = this.resultFactory.from(() => fs.renameSync(tmpPath, destinationFilePath))
    if (!renameResult.ok) return renameResult

    const verifyResult = this.resultFactory.from(() => {
      if (!existsSync(destinationFilePath) || statSync(destinationFilePath).size === 0) {
        return err(new Error(`Exported file is missing or empty: ${destinationFilePath}`))
      }
      return ok(undefined)
    })
    if (!verifyResult.ok) return verifyResult

    return ok(undefined)
  }

  private async handleFailure(
    worker: ExtractionWorker,
    item: QueueItem,
    queue: QueueItem[],
    error: unknown
  ): Promise<void> {
    const isTimeout = isTypedError(error, ConversationExtractor.NoDataError)
    const isContextLost = isTypedError(error, ConversationExtractor.ExtractionError)

    if (isTimeout) worker.extractor.recoverTimeout()

    if (isContextLost) {
      logger.warn('Browser context lost. Refreshing worker context...')
      await this.refreshContext()
    }

    if (item.attempts < MAX_RETRIES) {
      item.attempts++
      logger.warn(`Retrying ${item.meta.url} (attempt ${item.attempts}/${MAX_RETRIES})...`)
      queue.push(item)
      return
    }

    errorBus.emitError(`Failed to process ${item.meta.url} after ${MAX_RETRIES} retries`, error, {
      url: item.meta.url,
      attempts: item.attempts,
      conversationId: item.meta.id,
    })
  }

  private async refreshContext(): Promise<void> {
    if (this.isRefreshing) return
    this.isRefreshing = true
    const result = await this.resultFactory.from(async () => await this.replaceBrowserContext())
    if (!result.ok) {
      errorBus.emitError('Failed to refresh worker context', result.error)
    }
    this.isRefreshing = false
  }

  private async replaceBrowserContext(): Promise<void> {
    // best-effort close before re-creating; a stale context is what we are refreshing away.
    try {
      await this.sharedBrowserContext?.close()
    } catch (closeError) {
      logger.debug('refreshContext: sharedBrowserContext.close failed', errorMessageOf(closeError))
    } finally {
      // New context assignment is intentional after this block; nothing to cleanup here
    }
    this.sharedBrowserContext = await this.browser.newContext({
      storageState: this.config.authStoragePath,
    })
    for (const worker of this.workers) {
      worker.extractor = new ConversationExtractor(this.config, this.sharedBrowserContext)
    }
  }
}
