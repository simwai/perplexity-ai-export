import type { BrowserContext, Page, Response } from '@playwright/test'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'
import { z } from 'zod'

export interface ExtractedConversation {
  id: string
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
      status: z.string().optional(),
      entries: z.array(ConversationExtractor.EntrySchema),
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

  private readonly context: BrowserContext

  constructor(context: BrowserContext) {
    this.context = context
  }

  async extract(url: string): Promise<ExtractedConversation> {
    await this.ensureContextIsAlive()

    const conversationId = this.extractIdFromUrl(url)

    let page: Page | null = null
    try {
      page = await this.context.newPage()
    } catch (_error) {
      throw new ConversationExtractor.ExtractionError(
        `Failed to create new page: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }

    const apiDataPromise = this.captureConversationApiResponse(page, conversationId)

    try {
      await this.navigateToConversationUrl(page, url)
      await waitStrategy.afterScroll(page)

      const apiData = await apiDataPromise
      if (!apiData) {
        throw new ConversationExtractor.NoDataError('API response timeout or not found')
      }

      const parsed = this.parseConversationData(apiData, url)
      if (!parsed) {
        throw new ConversationExtractor.ParsingError('Failed to parse conversation data')
      }

      return parsed
    } catch (_error) {
      if (_error instanceof Error) throw _error
      throw new ConversationExtractor.ExtractionError(String(_error))
    } finally {
      if (page) {
        await page.close().catch((e) => {
          logger.warn(`Failed to close page: ${e}`)
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

  private captureConversationApiResponse(page: Page, conversationId: string): Promise<any> {
    let resolved = false

    // The per-thread *detail* endpoint is the only response that carries the
    // conversation blocks we need:
    //   /rest/thread/<id>?with_schematized_response=...
    // Several *list* endpoints also live under /rest/thread/ — list_recent,
    // list_pinned_ask_threads, list_ask_threads — but they return thread
    // summaries (no blocks), and list_pinned is frequently an empty array.
    // The old filter (includes('/rest/thread/') && !includes('list_ask_threads'))
    // let list_recent and list_pinned_ask_threads slip through, so whichever
    // fired first won the race and resolved the capture with empty data → the
    // "No valid entries found" / "Failed to parse conversation data" failures
    // seen in debug.log. Match the conversation id explicitly instead.
    const isDetailResponseUrl = (responseUrl: string): boolean => {
      if (!responseUrl.includes('/rest/thread/')) return false
      if (conversationId && conversationId !== 'unknown') {
        return responseUrl.includes(`/rest/thread/${conversationId}`)
      }
      // Fallback when we couldn't parse an id from the URL: accept any
      // /rest/thread/ response that isn't one of the list_* endpoints.
      return !/\/rest\/thread\/list_/.test(responseUrl)
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          logger.warn(
            `API response timeout (30s) — no /rest/thread/${conversationId} detail response ` +
              `captured; resolving with null`
          )
          resolved = true
          resolve(null)
        }
      }, 30000)

      page.on('response', async (response: Response) => {
        if (resolved) return

        const url = response.url()
        if (!isDetailResponseUrl(url)) {
          // Surface near-misses (sidebar list endpoints) at debug level so the
          // trace explains why a capture did or didn't match.
          if (url.includes('/rest/thread/')) {
            logger.debug(
              `captureConversationApiResponse: ignoring non-detail thread endpoint ${url}`
            )
          }
          return
        }

        logger.info(`Found matching thread API response: ${url}`)

        if (page.isClosed()) {
          logger.warn('Page is closed – cannot read response body')
          return
        }

        try {
          const json = await response.json()
          if (resolved) return

          const parseResult = ConversationExtractor.ApiResponseSchema.safeParse(json)
          if (!parseResult.success) {
            logger.warn(`API response validation failed: ${parseResult.error.message}`)
          }

          clearTimeout(timeout)
          resolved = true
          resolve(json)
        } catch (_error) {
          if (resolved) return
          logger.error(`Failed to parse JSON from thread API: ${_error}`)
        }
      })
    })
  }

  private async navigateToConversationUrl(page: Page, url: string): Promise<void> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    this.validateNavigationResponse(response, page, url)
  }

  private validateNavigationResponse(
    response: Response | null,
    page: Page,
    requestedUrl: string
  ): void {
    if (!response) {
      logger.debug(
        `validateNavigationResponse: no response for requestedUrl=${requestedUrl} ` +
          `pageUrl=${page.url()}`
      )
      throw new ConversationExtractor.NavigationError('Navigation failed – no response')
    }

    const status = response.status()
    const responseUrl = response.url()
    const finalPageUrl = page.url()

    if (status === 404) {
      logger.debug(
        `validateNavigationResponse: 404 requestedUrl=${requestedUrl} responseUrl=${responseUrl} ` +
          `pageUrl=${finalPageUrl}`
      )
      throw new ConversationExtractor.NotFoundError('Conversation not found (404)')
    }
    if (status === 403 || status === 401) {
      logger.debug(
        `validateNavigationResponse: AUTH ERROR status=${status} ` +
          `requestedUrl=${requestedUrl} responseUrl=${responseUrl} pageUrl=${finalPageUrl}`
      )
      throw new ConversationExtractor.AuthError('Authentication required or expired')
    }
    if (status >= 500) {
      logger.debug(
        `validateNavigationResponse: server error status=${status} responseUrl=${responseUrl}`
      )
      throw new ConversationExtractor.ServerError(`Server error (${status})`)
    }
    if (status >= 400) {
      logger.debug(
        `validateNavigationResponse: http error status=${status} responseUrl=${responseUrl}`
      )
      throw new ConversationExtractor.NavigationError(`HTTP error ${status}`)
    }
  }

  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    try {
      const entries = this.ensureEntriesFormat(data)

      const parseResult = z
        .array(ConversationExtractor.EntrySchema)
        .nonempty({ message: 'No valid entries found' })
        .safeParse(entries)

      if (!parseResult.success) {
        logger.warn(`Entry validation failed for ${url}: ${parseResult.error.message}`)
        return null
      }

      const validEntries = parseResult.data
      const firstEntry = validEntries[0]!
      const id = this.extractIdFromUrl(url)
      const title = firstEntry.thread_title ?? data.thread_title ?? 'Untitled'
      const spaceName =
        firstEntry.collection_info?.title ?? data.collection_info?.title ?? 'General'
      const timestamp = this.extractTimestamp(firstEntry, data)
      const content = this.convertEntriesToMarkdown(validEntries, title)

      if (!content) {
        logger.warn(`Thread has empty content after formatting: ${url}`)
        return null
      }

      return { id, title, spaceName, timestamp, content }
    } catch (_error) {
      logger.error('Failed to parse conversation data.')
      return null
    }
  }

  private ensureEntriesFormat(data: any): any[] {
    if (Array.isArray(data)) {
      return data
    }
    if (Array.isArray(data.entries) && data.entries.length > 0) {
      return data.entries
    }
    if (data && (data.query_str || data.blocks)) {
      return [data]
    }
    return []
  }

  private extractIdFromUrl(url: string): string {
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  private extractTimestamp(firstEntry: any, data: any): Date {
    const ts = firstEntry.updated_datetime ?? data.updated_datetime
    return ts ? new Date(ts) : new Date()
  }

  private convertEntriesToMarkdown(entries: any[], threadTitle: string): string {
    let markdown = ''

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      let question = entry.query_str ?? ''

      if (!question) {
        if (i === 0) {
          question = threadTitle
        } else {
          question = 'Follow‑up'
        }
      }

      let fullAnswer = ''
      for (const block of entry.blocks ?? []) {
        if (block.markdown_block?.answer) {
          fullAnswer += block.markdown_block.answer + '\n\n'
        }
      }

      if (question) {
        markdown += `## ${question}\n\n`
      }
      if (fullAnswer) {
        markdown += `${fullAnswer.trim()}\n\n`
      }
      markdown += '---\n\n'
    }

    return markdown.trim()
  }
}
