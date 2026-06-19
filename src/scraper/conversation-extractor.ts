import { type BrowserContext, type Page } from 'patchright'
import { type Config } from '../utils/config.js'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'
import { createWaitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'

import { PageNavigator } from './extractor/navigator.js'
import { ApiInterceptor } from './extractor/interceptor.js'
import { DataParser } from './extractor/parser.js'
import { MarkdownFormatter } from './extractor/formatter.js'
import { type ExtractedConversation } from './extractor/types.js'

export class ConversationExtractor {
  private static readonly MINIMUM_TIMEOUT_MILLISECONDS = 3000
  private static readonly MAXIMUM_TIMEOUT_MILLISECONDS = 15000
  private static readonly TIMEOUT_RECOVERY_STEP_MILLISECONDS = 2000
  private static readonly TIMEOUT_REDUCTION_STEP_MILLISECONDS = 1000

  private currentTimeoutMilliseconds = 8000
  private readonly pageNavigator = new PageNavigator()
  private readonly apiInterceptor: ApiInterceptor
  private readonly dataParser: DataParser
  private readonly markdownFormatter = new MarkdownFormatter()
  private readonly apiDiagnosticsWriter: ApiDiagnosticsWriter

  constructor(
    private readonly applicationConfig: Config,
    private readonly browserContext: BrowserContext
  ) {
    this.apiDiagnosticsWriter = new ApiDiagnosticsWriter(applicationConfig)
    this.apiInterceptor = new ApiInterceptor(this.apiDiagnosticsWriter)
    this.dataParser = new DataParser(this.apiDiagnosticsWriter)
  }

  reduceTimeout(): void {
    this.currentTimeoutMilliseconds = Math.max(
      ConversationExtractor.MINIMUM_TIMEOUT_MILLISECONDS,
      this.currentTimeoutMilliseconds - ConversationExtractor.TIMEOUT_REDUCTION_STEP_MILLISECONDS
    )
    logger.debug(`[extractor] timeout reduced to ${this.currentTimeoutMilliseconds}ms`)
  }

  recoverTimeout(): void {
    this.currentTimeoutMilliseconds = Math.min(
      ConversationExtractor.MAXIMUM_TIMEOUT_MILLISECONDS,
      this.currentTimeoutMilliseconds + ConversationExtractor.TIMEOUT_RECOVERY_STEP_MILLISECONDS
    )
  }

  async extract(conversationUrl: string): Promise<ExtractedConversation> {
    if (!this.browserContext) {
      return errorBus.raiseError('Browser context missing')
    }

    let conversationPage: Page | null = null
    try {
      conversationPage = await this.browserContext.newPage()
    } catch (pageCreationError) {
      return errorBus.raiseError(
        `Failed to create new page for ${conversationUrl}`,
        pageCreationError
      )
    }

    const captureApiResponsePromise = this.apiInterceptor.capture(
      conversationPage,
      this.currentTimeoutMilliseconds
    )

    try {
      await this.pageNavigator.navigateTo(conversationPage, conversationUrl)
      await createWaitStrategy(this.applicationConfig).afterScroll(conversationPage)

      const capturedApiData = await captureApiResponsePromise
      if (!capturedApiData) {
        errorBus.raiseError('API response timeout (no data captured)')
      }

      const parsedDataResult = this.dataParser.parse(capturedApiData, conversationUrl)
      if (!parsedDataResult) {
        errorBus.raiseError('Failed to parse API data')
      }

      return {
        conversationId: parsedDataResult!.meta.id,
        conversationTitle: parsedDataResult!.meta.title,
        conversationSpaceName: parsedDataResult!.meta.spaceName,
        extractionTimestamp: parsedDataResult!.meta.timestamp,
        contentIntegrityHash: parsedDataResult!.hash,
        formattedMarkdownContent: this.markdownFormatter.format(
          parsedDataResult!.entries,
          parsedDataResult!.meta.title
        ),
      }
    } catch (extractionError) {
      const isExpectedError =
        extractionError instanceof Error &&
        (extractionError.message.includes('timeout') || extractionError.message.includes('parse'))

      if (isExpectedError) {
        throw extractionError
      }
      return errorBus.raiseError(`Extraction failed for ${conversationUrl}`, extractionError)
    } finally {
      if (conversationPage) {
        await conversationPage.close().catch((pageCloseError) => {
          logger.warn(`Failed to close page: ${pageCloseError}`)
        })
      }
    }
  }
}
