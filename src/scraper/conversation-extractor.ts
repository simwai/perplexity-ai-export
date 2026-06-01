import { type BrowserContext, type Page } from 'patchright'
import { type Config } from '../utils/config.js'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'

import { PageNavigator } from './extractor/navigator.js'
import { ApiInterceptor } from './extractor/interceptor.js'
import { DataParser } from './extractor/parser.js'
import { MarkdownFormatter } from './extractor/formatter.js'
import { type ExtractedConversation } from './extractor/types.js'
import * as Errors from './extractor/errors.js'

export class ConversationExtractor {
  private static readonly TIMEOUT_MIN_MS = 3000
  private static readonly TIMEOUT_MAX_MS = 15000
  private static readonly TIMEOUT_STEP_UP_MS = 2000
  private static readonly TIMEOUT_STEP_DOWN_MS = 1000

  private currentTimeoutMs = 8000
  private readonly navigator = new PageNavigator()
  private readonly interceptor: ApiInterceptor
  private readonly parser: DataParser
  private readonly formatter = new MarkdownFormatter()
  private readonly diagnostics: ApiDiagnosticsWriter

  constructor(private readonly config: Config, private readonly context: BrowserContext) {
    this.diagnostics = new ApiDiagnosticsWriter(config)
    this.interceptor = new ApiInterceptor(this.diagnostics)
    this.parser = new DataParser(this.diagnostics)
  }

  reduceTimeout(): void {
    this.currentTimeoutMs = Math.max(ConversationExtractor.TIMEOUT_MIN_MS, this.currentTimeoutMs - ConversationExtractor.TIMEOUT_STEP_DOWN_MS)
    logger.debug(`[extractor] timeout reduced to ${this.currentTimeoutMs}ms`)
  }

  recoverTimeout(): void {
    this.currentTimeoutMs = Math.min(ConversationExtractor.TIMEOUT_MAX_MS, this.currentTimeoutMs + ConversationExtractor.TIMEOUT_STEP_UP_MS)
  }

  async extract(url: string): Promise<ExtractedConversation> {
    if (!this.context) throw new Errors.ExtractionError('Context missing')

    let page: Page | null = null
    try {
      page = await this.context.newPage()
    } catch (e) {
      throw new Errors.ExtractionError(`Failed to create page: ${String(e)}`)
    }

    const capturePromise = this.interceptor.capture(page, this.currentTimeoutMs)

    try {
      await this.navigator.navigateTo(page, url)
      await waitStrategy(this.config).afterScroll(page)

      const apiData = await capturePromise
      if (!apiData) throw new Errors.NoDataError('API response timeout')

      const parsed = this.parser.parse(apiData, url)
      if (!parsed) throw new Errors.ParsingError('Failed to parse data')

      return {
        ...parsed.meta,
        contentHash: parsed.hash,
        content: this.formatter.format(parsed.entries, parsed.meta.title)
      }
    } finally {
      if (page) await page.close().catch(e => logger.warn(`Failed to close page: ${e}`))
    }
  }
}
