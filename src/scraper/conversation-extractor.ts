import type { BrowserContext, Page, Response } from '@playwright/test'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'
import { z } from 'zod'

export interface ExtractedConversation {
  id: string
  title: string
  url: string
  spaceName: string
  timestamp: Date
  content: string
  messages: ExtractedConversationMessage[]
  rawApiResponse?: unknown
  rawEntries: unknown[]
}

export interface ExtractedConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  index: number
  entryIndex: number
}

interface CapturedApiResponse {
  data: any
  responseUrl: string
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

    let page: Page | null = null
    try {
      page = await this.context.newPage()
    } catch (_error) {
      throw new ConversationExtractor.ExtractionError(
        `Failed to create new page: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }

    const threadId = this.extractIdFromUrl(url)
    const apiDataPromise = this.captureConversationApiResponse(page, threadId)

    try {
      await this.navigateToConversationUrl(page, url)
      await waitStrategy.afterScroll(page)

      const apiCapture = await apiDataPromise
      if (!apiCapture) {
        throw new ConversationExtractor.NoDataError('API response timeout or not found')
      }

      const apiData = await this.fetchAllConversationPages(
        page,
        apiCapture.data,
        apiCapture.responseUrl
      )
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

  private captureConversationApiResponse(
    page: Page,
    threadId: string
  ): Promise<CapturedApiResponse | null> {
    let resolved = false

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          logger.warn('API response timeout – resolving with null')
          resolved = true
          resolve(null)
        }
      }, 30000)

      page.on('response', async (response: Response) => {
        if (resolved) return

        const url = response.url()
        if (!this.isThreadDetailApiResponse(url, threadId)) return

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
          resolve({ data: json, responseUrl: url })
        } catch (_error) {
          if (resolved) return
          logger.error(`Failed to parse JSON from thread API: ${_error}`)
        }
      })
    })
  }

  private async fetchAllConversationPages(
    page: Page,
    firstPageData: any,
    firstPageUrl: string
  ): Promise<any> {
    if (!this.shouldFetchNextPage(firstPageData)) {
      return firstPageData
    }

    const firstEntries = this.ensureEntriesFormat(firstPageData)
    const allEntries = [...firstEntries]
    let currentPageData = firstPageData
    const maxPages = 100
    const seenEntryKeys = new Set(firstEntries.map((entry) => this.getEntryIdentity(entry)))

    for (
      let pageIndex = 1;
      pageIndex < maxPages && this.shouldFetchNextPage(currentPageData);
      pageIndex++
    ) {
      const nextCursor = this.getNextCursor(currentPageData)
      if (!nextCursor) {
        logger.warn('Thread API reported another page but did not provide a next_cursor')
        break
      }

      const nextPageData = await this.fetchConversationPageAfterCursor(
        page,
        firstPageUrl,
        nextCursor
      )
      if (!nextPageData) {
        logger.warn('Could not fetch additional conversation page; using partial thread data')
        break
      }

      const nextEntries = this.ensureEntriesFormat(nextPageData)
      if (nextEntries.length === 0) {
        break
      }

      const newEntries = nextEntries.filter((entry) => {
        const key = this.getEntryIdentity(entry)
        if (seenEntryKeys.has(key)) return false
        seenEntryKeys.add(key)
        return true
      })
      if (newEntries.length === 0) {
        logger.warn('Conversation pagination returned only duplicate entries; stopping pagination')
        break
      }

      allEntries.push(...newEntries)
      currentPageData = nextPageData
    }

    if (allEntries.length === firstEntries.length) {
      return firstPageData
    }

    logger.info(`Fetched ${allEntries.length} thread entries across paginated API responses`)
    return {
      ...firstPageData,
      entries: allEntries,
      has_next_page: this.shouldFetchNextPage(currentPageData),
      next_cursor: currentPageData?.next_cursor,
    }
  }

  private shouldFetchNextPage(data: any): boolean {
    return !!(
      data &&
      typeof data === 'object' &&
      data.has_next_page === true &&
      Array.isArray(data.entries) &&
      data.entries.length > 0
    )
  }

  private getNextCursor(data: any): string | null {
    return typeof data?.next_cursor === 'string' && data.next_cursor.length > 0
      ? data.next_cursor
      : null
  }

  private getEntryIdentity(entry: any): string {
    for (const key of ['uuid', 'frontend_uuid', 'entry_uuid']) {
      const value = entry?.[key]
      if (typeof value === 'string' && value.length > 0) {
        return `${key}:${value}`
      }
    }

    const createdAt = entry?.entry_created_datetime ?? entry?.created_at ?? entry?.updated_datetime
    const query = typeof entry?.query_str === 'string' ? entry.query_str : ''
    return `fallback:${createdAt ?? ''}:${query}`
  }

  private async fetchConversationPageAfterCursor(
    page: Page,
    firstPageUrl: string,
    cursor: string
  ): Promise<any | null> {
    try {
      return await page.evaluate(
        async ({ firstPageUrl, cursor }) => {
          const nextUrl = new URL(firstPageUrl)
          nextUrl.searchParams.delete('offset')
          nextUrl.searchParams.set('from_first', 'false')
          nextUrl.searchParams.set('cursor', cursor)
          const response = await fetch(nextUrl.toString(), {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          })
          if (!response.ok) {
            return null
          }
          return response.json()
        },
        { firstPageUrl, cursor }
      )
    } catch (_error) {
      return null
    }
  }

  private isThreadDetailApiResponse(responseUrl: string, threadId: string): boolean {
    if (!threadId || threadId === 'unknown') return false

    try {
      const parsedUrl = new URL(responseUrl)
      const expectedPath = `/rest/thread/${threadId}`
      return parsedUrl.hostname.endsWith('perplexity.ai') && parsedUrl.pathname === expectedPath
    } catch (_error) {
      return false
    }
  }

  private async navigateToConversationUrl(page: Page, url: string): Promise<void> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    this.validateNavigationResponse(response)
  }

  private validateNavigationResponse(response: Response | null): void {
    if (!response) {
      throw new ConversationExtractor.NavigationError('Navigation failed – no response')
    }

    const status = response.status()
    if (status === 404) {
      throw new ConversationExtractor.NotFoundError('Conversation not found (404)')
    }
    if (status === 403 || status === 401) {
      throw new ConversationExtractor.AuthError('Authentication required or expired')
    }
    if (status >= 500) {
      throw new ConversationExtractor.ServerError(`Server error (${status})`)
    }
    if (status >= 400) {
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
      const messages = this.normalizeEntriesToMessages(validEntries, title)

      if (!content && messages.length === 0) {
        logger.warn(`Thread has empty content after formatting: ${url}`)
        return null
      }

      return {
        id,
        title,
        url,
        spaceName,
        timestamp,
        content,
        messages,
        rawApiResponse: data,
        rawEntries: validEntries,
      }
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

  private normalizeEntriesToMessages(
    entries: any[],
    threadTitle: string
  ): ExtractedConversationMessage[] {
    const messages: ExtractedConversationMessage[] = []

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex]
      const question = this.extractQuestionText(entry, threadTitle, entryIndex)
      const answer = this.extractAnswerText(entry)

      if (question) {
        messages.push({
          id: `${entryIndex + 1}-user`,
          role: 'user',
          content: question,
          index: messages.length,
          entryIndex,
        })
      }

      if (answer) {
        messages.push({
          id: `${entryIndex + 1}-assistant`,
          role: 'assistant',
          content: answer,
          index: messages.length,
          entryIndex,
        })
      }
    }

    return messages
  }

  private extractQuestionText(entry: any, threadTitle: string, entryIndex: number): string {
    if (entry.query_str) return entry.query_str
    return entryIndex === 0 ? threadTitle : 'Follow-up'
  }

  private extractAnswerText(entry: any): string {
    return (entry.blocks ?? [])
      .map((block: any) => block.markdown_block?.answer)
      .filter(
        (answer: unknown): answer is string => typeof answer === 'string' && answer.length > 0
      )
      .join('\n\n')
      .trim()
  }
}
