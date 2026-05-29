import { createHash } from 'node:crypto'
import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Page, type BrowserContext, type Response } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { waitStrategy } from '../utils/wait-strategy.js'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'
import { type Config } from '../utils/config.js'

export interface ExtractedConversation {
  id: string
  contentHash: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
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

  private static readonly ApiResponseSchema = z.union([
    z.array(ConversationExtractor.EntrySchema),
    z.object({
      entries: z.array(ConversationExtractor.EntrySchema),
      background_entries: z.array(z.unknown()).optional(),
      collection_info: z
        .object({
          has_next_page: z.boolean().optional(),
        })
        .optional(),
    }),
  ])

  static readonly ExtractionError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ExtractionError'
    }
  }

  static readonly NavigationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NavigationError'
    }
  }

  static readonly NotFoundError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NotFoundError'
    }
  }

  static readonly AuthError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AuthError'
    }
  }

  static readonly ServerError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ServerError'
    }
  }

  static readonly NoDataError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NoDataError'
    }
  }

  static readonly ParsingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ParsingError'
    }
  }

  private readonly diagnostics: ApiDiagnosticsWriter

  constructor(
    private readonly config: Config,
    private readonly context: BrowserContext
  ) {
    this.diagnostics = new ApiDiagnosticsWriter(config)
  }

  async extract(conversationUrl: string): Promise<ExtractedConversation> {
    await this.ensureContextIsAlive()

    let conversationPage: Page | null = null
    try {
      conversationPage = await this.context.newPage()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new ConversationExtractor.ExtractionError(`Failed to create new page: ${errorMessage}`)
    }

    const apiResponsePromise = this.captureConversationApiResponse(conversationPage)

    try {
      await this.navigateToConversationUrl(conversationPage, conversationUrl)
      await waitStrategy(this.config).afterScroll(conversationPage)

      const capturedApiData = await apiResponsePromise
      if (!capturedApiData) {
        throw new ConversationExtractor.NoDataError('API response timeout or not found')
      }

      const extractedConversation = this.parseConversationData(capturedApiData, conversationUrl)
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
          logger.warn(`Failed to close page: ${closeError}`)
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

  private captureConversationApiResponse(page: Page): Promise<unknown> {
    const accumulatedEntries: unknown[] = []
    let isRequestResolved = false

    return new Promise((resolve) => {
      const API_TIMEOUT_MS = 30000
      const timeoutId = setTimeout(() => {
        if (!isRequestResolved) {
          const hasAccumulatedEntries = accumulatedEntries.length > 0
          if (hasAccumulatedEntries) {
            logger.info(
              `API response timeout – resolving with ${accumulatedEntries.length} accumulated entries`
            )
            resolve({ entries: accumulatedEntries })
          } else {
            logger.warn('API response timeout – resolving with null')
            resolve(null)
          }
          isRequestResolved = true
        }
      }, API_TIMEOUT_MS)

      page.on('response', async (response: Response) => {
        if (isRequestResolved) return

        const responseUrl = response.url()
        const isThreadApiRequest = responseUrl.includes('/rest/thread/')
        const isListRequest =
          responseUrl.includes('list_ask_threads') ||
          responseUrl.includes('list_recent') ||
          responseUrl.includes('list_pinned')

        if (!isThreadApiRequest || isListRequest) return

        if (page.isClosed()) return

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
              .catch(() => {})
          } else {
            const responseData = parseResult.data
            const currentEntries = Array.isArray(responseData) ? responseData : responseData.entries
            accumulatedEntries.push(...currentEntries)

            const hasNextPage =
              !Array.isArray(responseData) && responseData.collection_info?.has_next_page === true
            if (!hasNextPage) {
              clearTimeout(timeoutId)
              isRequestResolved = true
              resolve({ entries: accumulatedEntries })
            } else {
              logger.info(
                `Captured paginated response, ${accumulatedEntries.length} entries so far...`
              )
            }
          }
        } catch (_error) {
          // Silent catch for JSON parse errors from non-JSON responses
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
    const stableJsonString = JSON.stringify(rawEntries, (_key, value) => {
      const isObjectButNotArray = value && typeof value === 'object' && !Array.isArray(value)
      if (isObjectButNotArray) {
        return Object.keys(value)
          .sort()
          .reduce((sortedObj: Record<string, unknown>, currentKey) => {
            sortedObj[currentKey] = (value as Record<string, unknown>)[currentKey]
            return sortedObj
          }, {})
      }
      return value
    })
    return createHash('sha256').update(stableJsonString).digest('hex')
  }

  private parseConversationData(
    apiData: unknown,
    conversationUrl: string
  ): ExtractedConversation | null {
    try {
      const formattedEntries = this.ensureEntriesFormat(apiData, conversationUrl)

      const entriesValidationResult = z
        .array(ConversationExtractor.EntrySchema)
        .nonempty({ message: 'No valid entries found' })
        .safeParse(formattedEntries)

      if (!entriesValidationResult.success) {
        const isEmptyEntries = formattedEntries.length === 0
        if (isEmptyEntries) {
          this.diagnostics
            .writeFailure({
              url: conversationUrl,
              errorType: 'empty_entries',
            })
            .catch(() => {})
        }
        logger.warn(
          `Entry validation failed for ${conversationUrl}: ${entriesValidationResult.error.message}`
        )
        return null
      }

      const validatedEntries = entriesValidationResult.data
      const firstEntry = validatedEntries[0]!
      const conversationId = this.extractIdFromUrl(conversationUrl)

      const threadTitleFromData = (apiData as any)?.thread_title
      const collectionTitleFromData = (apiData as any)?.collection_info?.title

      const title = firstEntry.thread_title ?? threadTitleFromData ?? 'Untitled'
      const spaceName = firstEntry.collection_info?.title ?? collectionTitleFromData ?? 'General'
      const timestamp = this.extractTimestamp(firstEntry, apiData)
      const contentHash = this.hashEntries(validatedEntries)
      const markdownContent = this.convertEntriesToMarkdown(validatedEntries, title)

      const isContentEmpty = !markdownContent
      if (isContentEmpty) {
        logger.warn(`Thread has empty content after formatting: ${conversationUrl}`)
        return null
      }

      return {
        id: conversationId,
        title,
        spaceName,
        timestamp,
        content: markdownContent,
        contentHash,
      }
    } catch (error) {
      errorBus.emitError('Failed to parse conversation data.', error)
      return null
    }
  }

  private ensureEntriesFormat(data: unknown, url: string): unknown[] {
    const isDataArray = Array.isArray(data)
    if (isDataArray) {
      return data as unknown[]
    }

    const dataObject = data as Record<string, unknown>
    const hasEntriesArray = dataObject && Array.isArray(dataObject.entries)
    if (hasEntriesArray) {
      return dataObject.entries as unknown[]
    }

    const isSingleEntry = dataObject && (dataObject.query_str || dataObject.blocks)
    if (isSingleEntry) {
      return [data]
    }

    this.diagnostics
      .writeFailure({
        url,
        errorType: 'unknown_shape',
      })
      .catch(() => {})

    return []
  }

  private extractIdFromUrl(url: string): string {
    const CONVERSATION_ID_REGEX = /\/search\/([^/?]+)/
    const match = url.match(CONVERSATION_ID_REGEX)
    return match?.[1] ?? 'unknown'
  }

  private extractTimestamp(firstEntry: any, data: unknown): Date {
    const rawTimestamp = firstEntry.updated_datetime ?? (data as any)?.updated_datetime
    return rawTimestamp ? new Date(rawTimestamp) : new Date()
  }

  private convertEntriesToMarkdown(entries: unknown[], threadTitle: string): string {
    let markdownAccumulator = ''
    const typedEntries = entries as any[]

    for (let i = 0; i < typedEntries.length; i++) {
      const currentEntry = typedEntries[i]
      let questionText = currentEntry.query_str ?? ''

      const isMissingQuestion = !questionText
      if (isMissingQuestion) {
        const isFirstEntry = i === 0
        questionText = isFirstEntry ? threadTitle : 'Follow‑up'
      }

      let answerAccumulator = ''
      for (const currentBlock of currentEntry.blocks ?? []) {
        if (currentBlock.markdown_block?.answer) {
          answerAccumulator += currentBlock.markdown_block.answer + '\n\n'
        }
      }

      if (questionText) {
        markdownAccumulator += `## ${questionText}\n\n`
      }
      if (answerAccumulator) {
        markdownAccumulator += `${answerAccumulator.trim()}\n\n`
      }
      markdownAccumulator += '---\n\n'
    }

    return markdownAccumulator.trim()
  }
}
