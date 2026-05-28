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

  private readonly context: BrowserContext
  private readonly config: Config
  private readonly diagnostics: ApiDiagnosticsWriter

  constructor(config: Config, context: BrowserContext) {
    this.config = config
    this.context = context
    this.diagnostics = new ApiDiagnosticsWriter(config)
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
      await waitStrategy(this.config).afterScroll(page)

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

  private captureConversationApiResponse(page: Page): Promise<unknown> {
    let allEntries: unknown[] = []
    let resolved = false

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          if (allEntries.length > 0) {
            logger.info(
              `API response timeout – resolving with ${allEntries.length} accumulated entries`
            )
            resolve({ entries: allEntries })
          } else {
            logger.warn('API response timeout – resolving with null')
            resolve(null)
          }
          resolved = true
        }
      }, 30000)

      page.on('response', async (response: Response) => {
        if (resolved) return

        const url = response.url()
        if (
          !url.includes('/rest/thread/') ||
          url.includes('list_ask_threads') ||
          url.includes('list_recent') ||
          url.includes('list_pinned')
        )
          return

        if (page.isClosed()) return

        try {
          const json = await response.json()
          if (resolved) return

          const parseResult = ConversationExtractor.ApiResponseSchema.safeParse(json)

          if (!parseResult.success) {
            this.diagnostics
              .writeFailure({
                url: response.url(),
                errorType: 'zod_error',
                zodErrorPaths: parseResult.error.issues.map((e) => e.path.join('.')),
              })
              .catch(() => {})
          } else {
            const data = parseResult.data
            const currentEntries = Array.isArray(data) ? data : data.entries
            allEntries.push(...currentEntries)

            const hasNextPage = !Array.isArray(data) && data.collection_info?.has_next_page === true
            if (!hasNextPage) {
              clearTimeout(timeout)
              resolved = true
              resolve({ entries: allEntries })
            } else {
              logger.info(`Captured paginated response, ${allEntries.length} entries so far...`)
            }
          }
        } catch (_error) {
          // Silent catch for JSON parse errors from other non-JSON responses
          // or if the response was already consumed/closed.
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

  private hashEntries(rawEntries: unknown[]): string {
    // Stringify with full content
    const stable = JSON.stringify(rawEntries, (_key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce((sorted: Record<string, unknown>, key) => {
                sorted[key] = (value as Record<string, unknown>)[key];
                return sorted;
            }, {});
        }
        return value;
    });
    return createHash('sha256').update(stable).digest('hex')
  }

  private parseConversationData(data: unknown, url: string): ExtractedConversation | null {
    try {
      const entries = this.ensureEntriesFormat(data, url)

      const parseResult = z
        .array(ConversationExtractor.EntrySchema)
        .nonempty({ message: 'No valid entries found' })
        .safeParse(entries)

      if (!parseResult.success) {
        if (entries.length === 0) {
          this.diagnostics
            .writeFailure({
              url,
              errorType: 'empty_entries',
            })
            .catch(() => {})
        }
        logger.warn(`Entry validation failed for ${url}: ${parseResult.error.message}`)
        return null
      }

      const validEntries = parseResult.data
      const firstEntry = validEntries[0]!
      const id = this.extractIdFromUrl(url)

      const threadTitle = (data as any)?.thread_title
      const collectionTitle = (data as any)?.collection_info?.title

      const title = firstEntry.thread_title ?? threadTitle ?? 'Untitled'
      const spaceName =
        firstEntry.collection_info?.title ?? collectionTitle ?? 'General'
      const timestamp = this.extractTimestamp(firstEntry, data)
      const contentHash = this.hashEntries(validEntries)
      const content = this.convertEntriesToMarkdown(validEntries, title)

      if (!content) {
        logger.warn(`Thread has empty content after formatting: ${url}`)
        return null
      }

      return { id, title, spaceName, timestamp, content, contentHash }
    } catch (_error) {
      errorBus.emitError('Failed to parse conversation data.')
      return null
    }
  }

  private ensureEntriesFormat(data: unknown, url: string): unknown[] {
    if (Array.isArray(data)) {
      return data
    }

    const d = data as Record<string, unknown>
    if (d && Array.isArray(d.entries)) {
      return d.entries
    }
    if (d && (d.query_str || d.blocks)) {
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
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  private extractTimestamp(firstEntry: any, data: unknown): Date {
    const ts = firstEntry.updated_datetime ?? (data as any)?.updated_datetime
    return ts ? new Date(ts) : new Date()
  }

  private convertEntriesToMarkdown(entries: unknown[], threadTitle: string): string {
    let markdown = ''
    const typedEntries = entries as any[]

    for (let i = 0; i < typedEntries.length; i++) {
      const entry = typedEntries[i]
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
