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

    let page: Page | null = null
    try {
      page = await this.context.newPage()
    } catch (_error) {
      throw new ConversationExtractor.ExtractionError(
        `Failed to create new page: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }

    const apiDataPromise = this.captureConversationApiResponse(page)

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

  private captureConversationApiResponse(page: Page): Promise<any> {
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
        if (!url.includes('/rest/thread/') || url.includes('list_ask_threads')) return

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
