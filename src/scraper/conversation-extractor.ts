import { type Page, type BrowserContext, type Response } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { createWaitStrategy } from '../utils/wait-strategy.js'
import { type Config } from '../utils/config.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createNamedError } from '../utils/errors.js'
import { ok, err, createResult, type Result } from 'super-result'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ExtractedConversation {
  id: string
  contentHash: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
  messages: ConversationMessage[]
}

export class ConversationExtractor {
  static readonly ExtractionError = createNamedError('ExtractionError')
  static readonly NavigationError = createNamedError('NavigationError')
  static readonly NotFoundError = createNamedError('NotFoundError')
  static readonly AuthError = createNamedError('AuthError')
  static readonly ServerError = createNamedError('ServerError')
  static readonly NoDataError = createNamedError('NoDataError')
  static readonly ParsingError = createNamedError('ParsingError')

  private static readonly TIMEOUT_MAX_MS = 30_000
  private static readonly TIMEOUT_MIN_MS = 8_000
  private static readonly TIMEOUT_STEP_DOWN_MS = 3_000
  private static readonly TIMEOUT_STEP_UP_MS = 1_000

  private currentTimeoutMs = ConversationExtractor.TIMEOUT_MAX_MS

  constructor(
    private readonly config: Config,
    private readonly context: BrowserContext
  ) {}

  reduceTimeout(): void {
    this.currentTimeoutMs = Math.max(
      ConversationExtractor.TIMEOUT_MIN_MS,
      this.currentTimeoutMs - ConversationExtractor.TIMEOUT_STEP_DOWN_MS
    )
    logger.debug(`[extractor] timeout reduced to ${this.currentTimeoutMs}ms`)
  }

  recoverTimeout(): void {
    this.currentTimeoutMs = Math.min(
      ConversationExtractor.TIMEOUT_MAX_MS,
      this.currentTimeoutMs + ConversationExtractor.TIMEOUT_STEP_UP_MS
    )
  }

  private readonly resultFactory = createResult<Error>((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  )

  async extract(
    conversationUrl: string,
    _expectedId?: string
  ): Promise<Result<ExtractedConversation, Error>> {
    const ensureResult = await this.ensureContextIsAlive()
    if (!ensureResult.ok) return err(ensureResult.error)

    const createPageResult = await this.resultFactory.from(() => this.context.newPage())
    const conversationPage = createPageResult.ok ? createPageResult.value : null

    if (!conversationPage) {
      return err(new ConversationExtractor.ExtractionError('Failed to create new page'))
    }

    const navigationResult = await this.navigateToConversationUrl(conversationPage, conversationUrl)
    if (!navigationResult.ok) return err(navigationResult.error)
    await createWaitStrategy(this.config).afterScroll(conversationPage)

    try {
      await conversationPage.close()
    } catch (closeError) {
      logger.warn(`Failed to close page: ${errorMessageOf(closeError)}`)
    }

    return err(new ConversationExtractor.NoDataError('Conversation extraction not yet implemented'))
  }

  private async ensureContextIsAlive(): Promise<Result<void, Error>> {
    const pagesResult = this.resultFactory.from(() => this.context.pages())
    return pagesResult.ok ? ok(undefined) : err(pagesResult.error)
  }

  private async navigateToConversationUrl(page: Page, url: string): Promise<Result<void, Error>> {
    const navigationResponse = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.currentTimeoutMs,
    })
    return this.validateNavigationResponse(navigationResponse)
  }

  private validateNavigationResponse(response: Response | null): Result<void, Error> {
    if (!response) {
      return err(new ConversationExtractor.NavigationError('Navigation failed – no response'))
    }

    const httpStatusCode = response.status()
    if (httpStatusCode === 404) {
      return err(new ConversationExtractor.NotFoundError('Conversation not found (404)'))
    }
    if (httpStatusCode === 403 || httpStatusCode === 401) {
      return err(new ConversationExtractor.AuthError('Authentication required or expired'))
    }
    if (httpStatusCode >= 500) {
      return err(new ConversationExtractor.ServerError(`Server error (${httpStatusCode})`))
    }
    if (httpStatusCode >= 400) {
      return err(new ConversationExtractor.NavigationError(`HTTP error ${httpStatusCode}`))
    }
    return ok(undefined)
  }
}
