import type { BrowserContext, Page, Response } from '@playwright/test'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'

export interface ExtractedConversation {
  id: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
}

export class ConversationExtractor {
  // ========== Custom Error Classes ==========
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

  // ========== Public API ==========

  /**
   * Extracts conversation data from a Perplexity thread URL.
   * @param url - The full URL of the conversation.
   * @returns Promise resolving to the extracted conversation.
   * @throws One of the custom errors above on failure.
   */
  async extract(url: string): Promise<ExtractedConversation> {
    const page = await this.context.newPage()
    const apiDataPromise = this.waitForApiResponse(page)

    try {
      await this.navigateToPage(page, url)
      await waitStrategy.afterScroll(page)

      const apiData = await apiDataPromise
      if (!apiData) {
        throw new ConversationExtractor.NoDataError('No API response intercepted')
      }

      const parsed = this.parseConversationData(apiData, url)
      if (!parsed) {
        throw new ConversationExtractor.ParsingError('Failed to parse conversation data')
      }

      return parsed
    } catch (error) {
      // Re-throw known errors; wrap unknown ones
      if (error instanceof Error) throw error
      throw new ConversationExtractor.ExtractionError(String(error))
    } finally {
      await page.close().catch(() => {})
    }
  }

  // ========== Private Helpers ==========

  /**
   * Sets up a listener for the thread API response and returns a promise
   * that resolves with the JSON data when the correct request is seen.
   */
  private waitForApiResponse(page: Page): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ConversationExtractor.NoDataError('API response timeout'))
      }, 15000)

      page.on('response', async (response: Response) => {
        const url = response.url()
        if (!url.includes('/rest/thread/') || url.includes('list_ask_threads')) return

        try {
          const json = await response.json()
          if (json.entries) {
            clearTimeout(timeout)
            resolve(json)
          }
        } catch {
          // Ignore non-JSON responses
        }
      })
    })
  }

  /**
   * Navigates to the given URL and validates the HTTP response.
   * @throws Appropriate error based on status code.
   */
  private async navigateToPage(page: Page, url: string): Promise<void> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    this.validateNavigationResponse(response)
  }

  /**
   * Throws appropriate errors based on the HTTP response status.
   */
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

  /**
   * Parses the raw API response into an ExtractedConversation object.
   * Returns null if the data cannot be parsed.
   */
  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    try {
      const entries = this.normalizeEntries(data)

      if (!entries.length) {
        logger.warn(`Thread has no entries: ${url}`)
        return null
      }

      const firstEntry = entries[0]
      const id = this.extractIdFromUrl(url)
      const title = firstEntry.thread_title ?? data.thread_title ?? 'Untitled'
      const spaceName =
        firstEntry.collection_info?.title ?? data.collection_info?.title ?? 'General'
      const timestamp = this.extractTimestamp(firstEntry, data)
      const content = this.formatEntries(entries)

      if (!content) {
        logger.warn(`Thread has empty content after formatting: ${url}`)
        return null
      }

      return { id, title, spaceName, timestamp, content }
      // oxlint-disable-next-line no-unused-vars
    } catch (_error) {
      // Log the raw data for debugging when parsing fails
      logger.error('Failed to parse conversation data. Raw response:')
      console.error(JSON.stringify(data, null, 2).slice(0, 1000)) // Limit output
      return null
    }
  }

  /**
   * Normalizes entries to always return an array of conversation turns.
   */
  private normalizeEntries(data: any): any[] {
    if (Array.isArray(data.entries) && data.entries.length > 0) {
      return data.entries
    }
    if (data && (data.query_str || data.blocks)) {
      return [data]
    }
    return []
  }

  /**
   * Extracts the conversation ID from the URL.
   */
  private extractIdFromUrl(url: string): string {
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  /**
   * Extracts the timestamp from the first entry or top-level data.
   */
  private extractTimestamp(firstEntry: any, data: any): Date {
    const ts = firstEntry.updated_datetime ?? data.updated_datetime
    return ts ? new Date(ts) : new Date()
  }

  /**
   * Formats conversation entries into a Markdown string.
   */
  private formatEntries(entries: any[]): string {
    let markdown = ''

    for (const entry of entries) {
      const question = entry.query_str ?? ''
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
