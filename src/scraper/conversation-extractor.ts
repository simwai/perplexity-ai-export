import { type Page, type BrowserContext, type Response } from '@playwright/test'
import { logger } from '../utils/logger.js'
import crypto from 'node:crypto'
import { createWaitStrategy } from '../utils/wait-strategy.js'
import { type Config } from '../utils/config.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { BaseAppError } from '../utils/errors.js'
import { ok, err, type Result, from } from 'super-result'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'
import { DEFAULT_API_VERSION } from './api-version.js'
import { z } from 'zod'

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

export class ExtractionError extends BaseAppError {}
export class NavigationError extends BaseAppError {}
export class NotFoundError extends BaseAppError {}
export class AuthError extends BaseAppError {}
export class ServerError extends BaseAppError {}
export class NoDataError extends BaseAppError {}
export class ParsingError extends BaseAppError {}

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

  hashEntries(entries: unknown[]): string {
    const sorted = entries.map((e) => this.sortEntryForHash(e))
    return crypto.createHash('sha256').update(sorted.join('|')).digest('hex')
  }

  private sortEntryForHash(entry: unknown): string {
    const str = JSON.stringify(entry)
    const result = from(() => JSON.stringify(this.sortKeys(JSON.parse(str))))
    return result.ok ? result.value : str
  }

  private sortKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map((item) => this.sortKeys(item))
    if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj as object)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = this.sortKeys((obj as Record<string, unknown>)[key])
            return acc
          },
          {} as Record<string, unknown>
        )
    }
    return obj
  }

  async extract(
    conversationUrl: string,
    _expectedId?: string
  ): Promise<
    Result<
      ExtractedConversation,
      | ExtractionErrorInstance
      | NavigationErrorInstance
      | NotFoundErrorInstance
      | AuthErrorInstance
      | ServerErrorInstance
      | NoDataErrorInstance
      | ParsingErrorInstance
    >
  > {
    const ensureResult = await this.ensureContextIsAlive()
    if (!ensureResult.ok) return err(ensureResult.error as ExtractionErrorInstance)

    const newPageResult = await from(async () => await this.context.newPage())
    if (!newPageResult.ok) {
      return err(new ExtractionError('Failed to create new page'))
    }
    const conversationPage = newPageResult.value

    const apiResponsePromise = this.captureConversationApiResponse(conversationPage, _expectedId)

    const navigationResult = await this.navigateToConversationUrl(conversationPage, conversationUrl)
    if (!navigationResult.ok) {
      const closeResult = await from(async () => {
        await conversationPage.close()
      })
      if (!closeResult.ok) {
        logger.warn(`Failed to close page: ${errorMessageOf(closeResult.error)}`)
      }
      return err(navigationResult.error as NavigationErrorInstance)
    }
    await createWaitStrategy(this.config).afterScroll(conversationPage)

    const capturedApiData = await apiResponsePromise
    if (!capturedApiData) {
      const closeResult = await from(async () => {
        await conversationPage.close()
      })
      if (!closeResult.ok) {
        logger.warn(`Failed to close page: ${errorMessageOf(closeResult.error)}`)
      }
      return err(new NoDataError('API response timeout or not found'))
    }

    const extractedConversation = this.parseConversationData(
      capturedApiData,
      conversationUrl,
      _expectedId
    )
    if (!extractedConversation.ok) {
      const closeResult = await from(async () => {
        await conversationPage.close()
      })
      if (!closeResult.ok) {
        logger.warn(`Failed to close page: ${errorMessageOf(closeResult.error)}`)
      }
      return err(extractedConversation.error as ParsingErrorInstance)
    }

    const closeResult = await from(async () => {
      await conversationPage.close()
    })
    if (!closeResult.ok) {
      logger.warn(`Failed to close page: ${errorMessageOf(closeResult.error)}`)
    }

    return ok(extractedConversation.value)
  }

  private async ensureContextIsAlive(): Promise<Result<void, ExtractionErrorInstance>> {
    const result = await from(async () => await this.context.pages())
    if (!result.ok) {
      const error = result.error
      return err(new ExtractionError(error instanceof Error ? error.message : String(error)))
    }
    return ok(undefined)
  }

  private async navigateToConversationUrl(
    page: Page,
    url: string
  ): Promise<Result<void, NavigationErrorInstance>> {
    const navigationResult = await from(
      async () =>
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.currentTimeoutMs,
        })
    )
    if (!navigationResult.ok) {
      return err(
        new NavigationError(`Navigation failed: ${errorMessageOf(navigationResult.error)}`)
      )
    }
    return this.validateNavigationResponse(navigationResult.value)
  }

  private validateNavigationResponse(
    response: Response | null
  ): Result<void, ConversationExtractorError> {
    if (!response) {
      return err(new NavigationError('Navigation failed – no response'))
    }

    const httpStatusCode = response.status()
    if (httpStatusCode === 404) {
      return err(new NotFoundError('Conversation not found (404)'))
    }
    if (httpStatusCode === 403 || httpStatusCode === 401) {
      return err(new AuthError('Authentication required or expired'))
    }
    if (httpStatusCode >= 500) {
      return err(new ServerError(`Server error (${httpStatusCode})`))
    }
    if (httpStatusCode >= 400) {
      return err(new NavigationError(`HTTP error ${httpStatusCode}`))
    }
    return ok(undefined)
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

        const jsonResult = await from(async () => await response.json())
        if (!jsonResult.ok) {
          logger.debug(
            `JSON parse failed for response ${response.url()}: ${errorMessageOf(jsonResult.error)}`
          )
          return
        }
        const jsonResponse = jsonResult.value

        const parseResult = ConversationExtractor.ApiResponseSchema.safeParse(jsonResponse)

        if (!parseResult.success) {
          this.diagnostics.writeFailure({
            url: response.url(),
            errorType: 'zod_error',
            zodErrorPaths: parseResult.error.issues.map((issue) => issue.path.join('.')),
          })
          return
        }

        const responseData = parseResult.data
        const currentEntries = Array.isArray(responseData) ? responseData : responseData.entries
        accumulatedEntries.push(...currentEntries)

        const hasNextPage = !Array.isArray(responseData) && responseData.has_next_page === true

        if (!hasNextPage) {
          clearTimeout(timeoutId)
          isRequestResolved = true
          resolve({ entries: accumulatedEntries, partial: false })
          return
        }

        logger.info(`Captured paginated response, ${accumulatedEntries.length} entries so far...`)
      })
    })
  }

  private parseConversationData(
    apiData: { entries: unknown[]; partial: boolean },
    conversationUrl: string,
    expectedId?: string
  ): Result<ExtractedConversation, ParsingErrorInstance> {
    const formattedEntries = this.ensureEntriesFormat(apiData.entries, conversationUrl)

    const entriesValidationResult = z
      .array(ConversationExtractor.EntrySchema)
      .nonempty({ message: 'No valid entries found' })
      .safeParse(formattedEntries)

    if (!entriesValidationResult.success) {
      if (formattedEntries.length === 0) {
        this.diagnostics.writeFailure({
          url: conversationUrl,
          errorType: 'empty_entries',
        })
      }
      logger.warn(
        `Entry validation failed for ${conversationUrl}: ${entriesValidationResult.error.message}`
      )
      return err(new ParsingError('Failed to parse conversation data'))
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
      return err(new ParsingError('Failed to parse conversation data'))
    }

    return ok({
      id: conversationId,
      title,
      spaceName,
      timestamp,
      content: markdownContent,
      contentHash,
      messages,
    })
  }

  private ensureEntriesFormat(data: unknown[], url: string): unknown[] {
    if (Array.isArray(data)) return data as unknown[]

    const dataObject = data as Record<string, unknown>
    if (dataObject && Array.isArray(dataObject.entries)) return dataObject.entries as unknown[]
    if (dataObject && (dataObject.query_str || dataObject.blocks)) return [data]

    logger.warn(`Unknown API response shape for ${url}`)
    this.diagnostics.writeFailure({ url, errorType: 'unknown_shape' }).catch(() => {})
    return []
  }

  private extractIdFromUrl(url: string): string {
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  private extractTimestamp(
    firstEntry: RawEntry,
    data: { entries: unknown[]; partial: boolean }
  ): Date {
    const parsed = ConversationExtractor.TimestampCarrierSchema.safeParse(data)
    const fallbackTimestamp = parsed.success ? parsed.data.updated_datetime : undefined
    const rawTimestamp = firstEntry.updated_datetime ?? fallbackTimestamp
    return rawTimestamp ? new Date(rawTimestamp) : new Date()
  }

  private parseMessages(entries: RawEntry[], threadTitle: string): ConversationMessage[] {
    const messages: ConversationMessage[] = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const question = entry.query_str ?? (i === 0 ? threadTitle : 'Follow-up')

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

type ExtractionErrorInstance = InstanceType<typeof ExtractionError>
type NavigationErrorInstance = InstanceType<typeof NavigationError>
type NotFoundErrorInstance = InstanceType<typeof NotFoundError>
type AuthErrorInstance = InstanceType<typeof AuthError>
type ServerErrorInstance = InstanceType<typeof ServerError>
type NoDataErrorInstance = InstanceType<typeof NoDataError>
type ParsingErrorInstance = InstanceType<typeof ParsingError>

export type ConversationExtractorError =
  | ExtractionErrorInstance
  | NavigationErrorInstance
  | NotFoundErrorInstance
  | AuthErrorInstance
  | ServerErrorInstance
  | NoDataErrorInstance
  | ParsingErrorInstance
