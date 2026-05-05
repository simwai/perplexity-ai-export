import { z } from 'zod'
import { logger } from '../utils/logger.js'
import type { Page, BrowserContext } from '@playwright/test'

export interface ExtractedConversation {
  id: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
}

export class ConversationExtractor {
  private static readonly EntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
  })

  private static readonly ApiResponseSchema = z.union([
    z.object({
      id: z.string(),
      title: z.string(),
      space_name: z.string(),
      created_at: z.string(),
      entries: z.array(ConversationExtractor.EntrySchema),
    }),
    z.object({
      status: z.string().optional(),
      entries: z.array(ConversationExtractor.EntrySchema),
    }),
  ])

  static readonly ExtractionError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'ExtractionError'
    }
  }

  static readonly NavigationError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'NavigationError'
    }
  }

  static readonly NotFoundError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'NotFoundError'
    }
  }

  static readonly AuthError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'AuthError'
    }
  }

  static readonly ServerError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'ServerError'
    }
  }

  static readonly NoDataError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'NoDataError'
    }
  }

  static readonly ParsingError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'ParsingError'
    }
  }

  private context: BrowserContext

  constructor(context: BrowserContext) {
    this.context = context
  }

  async extract(url: string): Promise<ExtractedConversation> {
    await this.ensureContextIsAlive()

    let page: Page | null = null
    try {
      page = await this.context.newPage()
    } catch (error) {
      throw new ConversationExtractor.ExtractionError(
        `Failed to create new page: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }

    const apiDataPromise = this.captureConversationApiResponse(page)

    try {
      await this.navigateToConversationUrl(page, url)
      const apiData = await apiDataPromise

      const parsed = this.parseConversationData(apiData, url)
      if (!parsed) {
        throw new ConversationExtractor.ParsingError('Failed to parse conversation data')
      }

      return parsed
    } catch (error) {
      if (error instanceof Error) throw error
      throw new ConversationExtractor.ExtractionError(String(error), { cause: error })
    } finally {
      if (page) {
        await page.close().catch((e: Error) => {
          logger.warn(`Failed to close page: ${e}`, e)
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
    } catch (error) {
      throw new ConversationExtractor.ExtractionError('Browser context is no longer available', { cause: error })
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
      }, 15000)

      page.on('response', async (response: any) => {
        if (resolved) return
        const url = response.url()
        if (!url.includes('/api/v1/threads/')) return

        try {
          const json = await response.json()
          const parseResult = ConversationExtractor.ApiResponseSchema.safeParse(json)
          if (!parseResult.success) {
            logger.warn(`API response validation failed: ${parseResult.error.message}`)
          }

          clearTimeout(timeout)
          resolved = true
          resolve(json)
        } catch (error) {
          if (resolved) return
          logger.error(`Failed to parse JSON from thread API: ${error}`, error)
        }
      })
    })
  }

  private async navigateToConversationUrl(page: Page, url: string): Promise<void> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    if (!response) {
      throw new ConversationExtractor.NavigationError(`Failed to get response from ${url}`)
    }

    if (response.status() === 404) {
      throw new ConversationExtractor.NotFoundError(`Conversation not found: ${url}`)
    }

    if (response.status() === 401 || response.status() === 403) {
      throw new ConversationExtractor.AuthError(`Authentication required for ${url}`)
    }

    if (response.status() >= 500) {
      throw new ConversationExtractor.ServerError(`Server error at ${url}: ${response.status()}`)
    }
  }

  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    if (!data) return null

    try {
      const id = url.split('/').pop()?.split('?')[0] || 'unknown'
      const title = data.title || 'Untitled'
      const spaceName = data.space_name || 'Personal'
      const timestamp = data.created_at ? new Date(data.created_at) : new Date()

      const entries = this.ensureEntriesFormat(data)
      const content = entries
        .map((entry: any) => `### ${entry.name}\n\n${entry.content}`)
        .join('\n\n')

      if (!content) {
        logger.warn(`Thread has empty content after formatting: ${url}`)
        return null
      }

      return { id, title, spaceName, timestamp, content }
    } catch (error) {
      logger.error('Failed to parse conversation data.', error)
      return null
    }
  }

  private ensureEntriesFormat(data: any): any[] {
    if (data.entries && Array.isArray(data.entries)) {
      return data.entries
    }
    return []
  }
}
