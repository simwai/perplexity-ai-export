import type { Browser, BrowserContext, Page } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
import { ConversationExtractor, type ExtractedConversation } from './conversation-extractor.js'
import { FileWriter } from '../export/file-writer.js'
import type { CheckpointManager, ConversationMetadata } from './checkpoint-manager.js'

interface Worker {
  id: number
  context: BrowserContext
  page: Page
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

export class WorkerPool {
  private workers: Worker[] = []
  private readonly fileWriter: FileWriter
  private readonly checkpointManager: CheckpointManager
  private stats: ProcessingStats = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  }

  constructor(checkpointManager: CheckpointManager) {
    this.fileWriter = new FileWriter()
    this.checkpointManager = checkpointManager
  }

  async initialize(browser: Browser): Promise<void> {
    logger.info(`Initializing worker pool with ${config.parallelWorkers} workers...`)

    for (let i = 0; i < config.parallelWorkers; i++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const extractor = new ConversationExtractor(context)

      this.workers.push({
        id: i + 1,
        context,
        page,
        extractor,
        isBusy: false,
      })
    }

    logger.success(`Worker pool ready with ${this.workers.length} workers`)
  }

  async processConversations(conversations: ConversationMetadata[]): Promise<void> {
    this.stats.total = conversations.length
    logger.info(`Processing ${conversations.length} conversations in parallel...`)

    const queue: ConversationMetadata[] = [...conversations]
    const active: Promise<void>[] = []

    for (const worker of this.workers) {
      active.push(this.workerLoop(worker, queue))
    }

    await Promise.all(active)
    this.printSummary()
  }

  private async workerLoop(worker: Worker, queue: ConversationMetadata[]): Promise<void> {
    // Simple worker loop: each worker keeps pulling from the shared queue until it is empty
    for (; ;) {
      const conversation = queue.shift()
      if (!conversation) {
        logger.debug(`Worker ${worker.id} finished (queue empty)`)
        return
      }

      worker.isBusy = true

      try {
        // Randomized small delay to avoid a thundering herd on Perplexity
        const delay = 1000 + Math.random() * 2000
        await new Promise((resolve) => setTimeout(resolve, delay))

        logger.info(
          `Worker ${worker.id} → ${conversation.title.substring(0, 80)} (${conversation.url})`,
        )

        const extracted = await worker.extractor.extract(conversation.url)

        if (!extracted) {
          logger.warn(
            `Worker ${worker.id} skipped: ${conversation.title} (no extractable content)`,
          )
          this.stats.skipped++
          this.stats.failures.push({
            url: conversation.url,
            title: conversation.title,
            reason: 'No extractable content (empty thread or auth issue)',
          })
          continue
        }

        const filepath = this.fileWriter.write(extracted)

        const validationError = this.validateFile(filepath, extracted)
        if (validationError) {
          logger.error(
            `Worker ${worker.id} validation failed for ${conversation.title}: ${validationError}`,
          )
          this.stats.failed++
          this.stats.failures.push({
            url: conversation.url,
            title: conversation.title,
            reason: `File validation failed: ${validationError}`,
          })
          continue
        }

        logger.success(`Worker ${worker.id} saved: ${filepath}`)
        this.stats.succeeded++
        this.checkpointManager.markProcessed(conversation.url)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Worker ${worker.id} failed for ${conversation.title}`)
        logger.error(`  URL: ${conversation.url}`)
        logger.error(`  Error: ${message}`)
        this.stats.failed++
        this.stats.failures.push({
          url: conversation.url,
          title: conversation.title,
          reason: message,
        })
        // Do not mark as processed
      } finally {
        worker.isBusy = false
      }
    }
  }

  private validateFile(filepath: string, extracted: ExtractedConversation): string | null {
    try {
      if (!existsSync(filepath)) {
        return 'File not found after write'
      }

      const stats = statSync(filepath)
      if (stats.size === 0) {
        return 'File is empty'
      }

      if (stats.size < 50) {
        return `File too small (${stats.size} bytes)`
      }

      const content = readFileSync(filepath, 'utf-8')

      if (!content.includes('##')) {
        return 'Missing question headers (##)'
      }

      if (!content.includes('---')) {
        return 'Missing separators (---)'
      }

      if (!content.includes(`# ${extracted.title}`)) {
        return 'Title not found in file content'
      }

      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Validation exception: ${message}`
    }
  }

  private printSummary(): void {
    const line = '='.repeat(70)
    console.log(`\n${line}`)
    logger.info('📊 EXPORT SUMMARY')
    console.log(line)

    logger.info(`Total conversations: ${this.stats.total}`)
    logger.success(`✓ Successfully exported: ${this.stats.succeeded}`)

    if (this.stats.skipped > 0) {
      logger.warn(`⚠ Skipped (no extractable content): ${this.stats.skipped}`)
    }

    if (this.stats.failed > 0) {
      logger.error(`✗ Failed: ${this.stats.failed}`)
    }

    if (this.stats.failures.length > 0) {
      console.log('\n❌ Failed / Skipped Conversations:')
      console.log('-'.repeat(70))
      for (const failure of this.stats.failures) {
        logger.error(`\n  ${failure.title}`)
        logger.error(`    URL: ${failure.url}`)
        logger.error(`    Reason: ${failure.reason}`)
      }
      console.log()
    }

    console.log(line + '\n')

    if (this.stats.failed > 0 || this.stats.skipped > 0) {
      logger.info('💡 Failed/skipped conversations were NOT marked as processed.')
      logger.info('   You can rerun the scraper to retry them.')
    }
  }

  async close(): Promise<void> {
    for (const worker of this.workers) {
      await worker.context.close()
    }
    logger.info('Worker pool closed')
  }
}
