import { createHash } from 'node:crypto'
import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Page, type BrowserContext, type Response } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { createWaitStrategy } from '../utils/wait-strategy.js'
import { type Config } from '../utils/config.js'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createNamedError } from '../utils/errors.js'
import { DEFAULT_API_VERSION } from './api-version.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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

type RawEntry = {
  thread_title?: string
  collection_info?: { title?: string }
  updated_datetime?: string
  query_str?: string
  blocks?: Array<{ intended_usage?: string; markdown_block?: { answer?: string } }>
}

export class ConversationExtractor {
  private static readonly BlockSchema = z.object({
    intended_usage: z.string().optional(),
    markdown_block: z
      .object({
        answer: z.string().optional(),
      })
      .optional(),
  })

  private static readonly EntrySchema = z.object({
    thread_title: z.string().optional(),
    collection_info: z
      .object({
        title: z.string().optional(),
      })
      .optional(),
    updated_datetime: z.string().optional(),
    query_str: z.string().optional(),
    blocks: z.array(ConversationExtractor.BlockSchema).optional(),
  })

  /**
   * Validates the top-level shape of the `/rest/thread/{id}` HTTP response,
   * confirmed against a live 2026 response. The endpoint returns either a bare
   * array of entries or an object wrapping them; pagination is signalled by the
   * top-level `has_next_page` / `next_cursor` pair. Fields are optional and the
   * object is non-strict, so unknown/new keys don't reject an otherwise-valid
   * response — shape drift is surfaced via diagnostics, and `EntrySchema`
   * remains the per-entry fallback downstream.
   */
  private static readonly ApiResponseSchema = z.union([
    z.array(ConversationExtractor.EntrySchema),
    z.object({
      entries: z.array(ConversationExtractor.EntrySchema),
      background_entries: z.array(z.unknown()).optional(),
      has_next_page: z.boolean().optional(),
      next_cursor: z.string().nullable().optional(),
      status: z.string().optional(),
      thread_metadata: z.unknown().optional(),
      collection_info: z
        .object({
          has_next_page: z.boolean().optional(),
        })
        .optional(),
    }),
  ])

  private static readonly TimestampCarrierSchema = z.object({
    updated_datetime: z.string().optional(),
  })

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
  private readonly diagnostics: ApiDiagnosticsWriter

  constructor(
    private readonly config: Config,
    private readonly context: BrowserContext
  ) {
    this.diagnostics = new ApiDiagnosticsWriter(config)
  }

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

  async extract(conversationUrl: string, expectedId?: string): Promise<ExtractedConversation> {
    await this.ensureContextIsAlive()

    let conversationPage: Page | null = null
    try {
      conversationPage = await this.context.newPage()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new ConversationExtractor.ExtractionError(`Failed to create new page: ${errorMessage}`)
    }

    const apiResponsePromise = this.captureConversationApiResponse(conversationPage, expectedId)

    try {
      await this.navigateToConversationUrl(conversationPage, conversationUrl)
      await createWaitStrategy(this.config).afterScroll(conversationPage)

      const capturedApiData = await apiResponsePromise
      if (!capturedApiData) {
        throw new ConversationExtractor.NoDataError('API response timeout or not found')
      }

      const extractedConversation = this.parseConversationData(
        capturedApiData,
        conversationUrl,
        expectedId
      )
      if (!extractedConversation) {
        throw new ConversationExtractor.ParsingError('Failed to parse conversation data')
      }

      return extractedConversation
    } catch (error) {
      if (error instanceof Error) throw error
      throw new ConversationExtractor.ExtractionError(String(error))
    } finally {
      if (conversationPage) {
        await conversationPage.close().catch((closeError) => {
          logger.warn(`Failed to close page: ${errorMessageOf(closeError)}`)
        })
      }
    }
  }

  private async ensureContextIsAlive(): Promise<void> {
    if (!this.context) {
      throw new ConversationExtractor.ExtractionError('Browser context is missing')
    }
    try {
      await this.context.pages()
    } catch (_error) {
      throw new ConversationExtractor.ExtractionError('Browser context is no longer available')
    }
  }

  private captureConversationApiResponse(
    page: Page,
    expectedId?: string
  ): Promise<{ entries: unknown[]; partial: boolean } | null> {
    const accumulatedEntries: unknown[] = []
    let isRequestResolved = false
    const expectedVersionToken = `version=${encodeURIComponent(DEFAULT_API_VERSION)}`
    const expectedThreadToken = expectedId ? `/rest/thread/${expectedId}` : ''

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        if (!isRequestResolved) {
          if (accumulatedEntries.length > 0) {
            logger.info(
              `API response timeout – resolving with ${accumulatedEntries.length} accumulated entries (partial)`
            )
            resolve({ entries: accumulatedEntries, partial: true })
          } else {
            logger.warn('API response timeout – resolving with null')
            resolve(null)
          }
          isRequestResolved = true
        }
      }, this.currentTimeoutMs)

      page.on('response', async (response: Response) => {
        if (isRequestResolved) return

        const responseUrl = response.url()
        const isThreadApiRequest = responseUrl.includes('/rest/thread/')
        const isListRequest =
          responseUrl.includes('list_ask_threads') ||
          responseUrl.includes('list_recent') ||
          responseUrl.includes('list_pinned')

        if (!isThreadApiRequest || isListRequest) return
        if (expectedThreadToken && !responseUrl.includes(expectedThreadToken)) return
        if (page.isClosed()) return

        if (!responseUrl.includes(expectedVersionToken) && responseUrl.includes('version=')) {
          logger.debug(`[extractor] thread response version drift: ${responseUrl}`)
        }

        try {
          const jsonResponse = await response.json()
          if (isRequestResolved) return

          const parseResult = ConversationExtractor.ApiResponseSchema.safeParse(jsonResponse)

          if (!parseResult.success) {
            this.diagnostics
              .writeFailure({
                url: response.url(),
                errorType: 'zod_error',
                zodErrorPaths: parseResult.error.issues.map((issue) => issue.path.join('.')),
              })
              // why: best-effort diagnostics write; must not block the capture pipeline
              .catch(() => {})
          } else {
            const responseData = parseResult.data
            const currentEntries = Array.isArray(responseData) ? responseData : responseData.entries
            accumulatedEntries.push(...currentEntries)

            const hasNextPage = !Array.isArray(responseData) && responseData.has_next_page === true

            if (!hasNextPage) {
              clearTimeout(timeoutId)
              isRequestResolved = true
              resolve({ entries: accumulatedEntries, partial: false })
            } else {
              logger.info(
                `Captured paginated response, ${accumulatedEntries.length} entries so far...`
              )
            }
          }
        } catch (error) {
          logger.debug(`JSON parse failed for response ${response.url()}: ${errorMessageOf(error)}`)
        }
      })
    })
  }

  private async navigateToConversationUrl(page: Page, url: string): Promise<void> {
    const NAVIGATION_TIMEOUT_MS = 30000
    const navigationResponse = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    })
    this.validateNavigationResponse(navigationResponse)
  }

  private validateNavigationResponse(response: Response | null): void {
    if (!response) {
      throw new ConversationExtractor.NavigationError('Navigation failed – no response')
    }

    const httpStatusCode = response.status()
    if (httpStatusCode === 404) {
      throw new ConversationExtractor.NotFoundError('Conversation not found (404)')
    }
    if (httpStatusCode === 403 || httpStatusCode === 401) {
      throw new ConversationExtractor.AuthError('Authentication required or expired')
    }
    if (httpStatusCode >= 500) {
      throw new ConversationExtractor.ServerError(`Server error (${httpStatusCode})`)
    }
    if (httpStatusCode >= 400) {
      throw new ConversationExtractor.NavigationError(`HTTP error ${httpStatusCode}`)
    }
  }

  private hashEntries(rawEntries: unknown[]): string {
    const contentOnlyEntries = rawEntries.map((entry) => {
      // why: API contract returns an object shape; downstream property reads are guarded by zod elsewhere
      const typedEntry = entry as Record<string, unknown>
      return {
        thread_title: typedEntry.thread_title,
        collection_info: typedEntry.collection_info,
        query_str: typedEntry.query_str,
        blocks: typedEntry.blocks,
      }
    })

    const stableJsonString = JSON.stringify(contentOnlyEntries, (_key, value) => {
      if (!isPlainObject(value)) return value
      const sortedObj: Record<string, unknown> = {}
      for (const currentKey of Object.keys(value).sort()) {
        sortedObj[currentKey] = value[currentKey]
      }
      return sortedObj
    })
    return createHash('sha256').update(stableJsonString).digest('hex')
  }

  private parseConversationData(
    apiData: unknown,
    conversationUrl: string,
    expectedId?: string
  ): ExtractedConversation | null {
    try {
      const formattedEntries = this.ensureEntriesFormat(apiData, conversationUrl)

      const entriesValidationResult = z
        .array(ConversationExtractor.EntrySchema)
        .nonempty({ message: 'No valid entries found' })
        .safeParse(formattedEntries)

      if (!entriesValidationResult.success) {
        if (formattedEntries.length === 0) {
          this.diagnostics
            .writeFailure({ url: conversationUrl, errorType: 'empty_entries' })
            // why: best-effort diagnostics write; must not block the parse pipeline
            .catch(() => {})
        }
        logger.warn(
          `Entry validation failed for ${conversationUrl}: ${entriesValidationResult.error.message}`
        )
        return null
      }

      const validatedEntries = entriesValidationResult.data
      const firstEntry = validatedEntries[0]!
      const conversationId = expectedId ?? this.extractIdFromUrl(conversationUrl)

      const title = firstEntry.thread_title ?? 'Untitled'
      const spaceName = firstEntry.collection_info?.title ?? 'General'
      const timestamp = this.extractTimestamp(firstEntry, apiData)
      const contentHash = this.hashEntries(validatedEntries)
      const messages = this.parseMessages(validatedEntries, title)
      const markdownContent = this.convertMessagesToMarkdown(messages)

      if (!markdownContent && messages.length === 0) {
        logger.warn(`Thread has no content or messages: ${conversationUrl}`)
        return null
      }

      return {
        id: conversationId,
        title,
        spaceName,
        timestamp,
        content: markdownContent,
        contentHash,
        messages,
      }
    } catch (error) {
      errorBus.emitError('Failed to parse conversation data.', error)
      return null
    }
  }

  private ensureEntriesFormat(data: unknown, url: string): unknown[] {
    if (Array.isArray(data)) return data as unknown[]

    // why: runtime guards below (Array.isArray, property checks) precede the cast
    const dataObject = data as Record<string, unknown>
    if (dataObject && Array.isArray(dataObject.entries)) return dataObject.entries as unknown[]
    if (dataObject && (dataObject.query_str || dataObject.blocks)) return [data]

    logger.warn(`Unknown API response shape for ${url}`)
    // why: best-effort diagnostics write; the parser still returns an empty array
    this.diagnostics.writeFailure({ url, errorType: 'unknown_shape' }).catch(() => {})
    return []
  }

  private extractIdFromUrl(url: string): string {
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  private extractTimestamp(firstEntry: RawEntry, data: unknown): Date {
    const parsed = ConversationExtractor.TimestampCarrierSchema.safeParse(data)
    const fallbackTimestamp = parsed.success ? parsed.data.updated_datetime : undefined
    const rawTimestamp = firstEntry.updated_datetime ?? fallbackTimestamp
    return rawTimestamp ? new Date(rawTimestamp) : new Date()
  }

  private parseMessages(entries: RawEntry[], threadTitle: string): ConversationMessage[] {
    const messages: ConversationMessage[] = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const question = entry.query_str ?? (i === 0 ? threadTitle : 'Follow‑up')

      if (question) {
        messages.push({ role: 'user', content: question })
      }

      let answer = ''
      for (const block of entry.blocks ?? []) {
        if (block.markdown_block?.answer) {
          answer += block.markdown_block.answer + '\n\n'
        }
      }

      if (answer.trim()) {
        messages.push({ role: 'assistant', content: answer.trim() })
      }
    }

    return messages
  }

  private convertMessagesToMarkdown(messages: ConversationMessage[]): string {
    let markdown = ''
    for (const message of messages) {
      if (message.role === 'user') {
        markdown += `## ${message.content}\n\n`
      } else {
        markdown += `${message.content}\n\n---\n\n`
      }
    }
    return markdown.trim()
  }
}
