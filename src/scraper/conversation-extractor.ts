import type { Page, BrowserContext } from '@playwright/test'
import crypto from 'node:crypto'
import { logger } from '../utils/logging/logger.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { BaseAppError } from '../utils/errors.js'
import { ok, err, type Result, from } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/logging/api-diagnostics.js'
import { DEFAULT_API_VERSION } from './api-version.js'
import { fetchThreadById } from './library-discovery.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { assertSafeFilename, slugify } from '../utils/shell-safety.js'

// ─── Public types ────────────────────────────────────────────────────────────

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

  /**
   * Filesystem-safe filename for this conversation. Always derived from
   * `id` (a UUID), never from `title`. Use this whenever a path is needed.
   *
   * The `title` and `content` fields are raw, untrusted strings from the
   * Perplexity API. Do NOT pass them to:
   *   - shell commands (exec / execSync / spawn with shell:true)
   *   - path building (path.join, fs.writeFile with a caller-supplied name)
   *   - SQL, HTML, YAML, JSON-as-shell-arg, etc.
   * without escaping for the target context.
   */
  safeFilename: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ExtractionError extends BaseAppError {}
export class NavigationError extends BaseAppError {}
export class NotFoundError extends BaseAppError {}
export class AuthError extends BaseAppError {}
export class ServerError extends BaseAppError {}
export class NoDataError extends BaseAppError {}
export class ParsingError extends BaseAppError {}

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

// ─── Internal types ──────────────────────────────────────────────────────────

type RawEntry = {
  thread_title?: string
  collection_info?: { title?: string }
  updated_datetime?: string
  query_str?: string
  blocks?: Array<{
    intended_usage?: string
    markdown_block?: { answer?: string }
  }>
}

// ─── Extractor ───────────────────────────────────────────────────────────────

export class ConversationExtractor {
  private static readonly BlockSchema = z.object({
    intended_usage: z.string().optional(),
    markdown_block: z
      .object({
        answer: z.string().optional(),
      })
      .optional(),
  })

  private static readonly EntrySchema = z
    .object({
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
    .passthrough()

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
    config: Config,
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

  // ─── Public entrypoint ────────────────────────────────────────────────────

  async extract(
    conversationUrl: string,
    expectedId?: string
  ): Promise<Result<ExtractedConversation, ConversationExtractorError>> {
    const pageResult = await this.getApiPage()
    if (!pageResult.ok) return err(pageResult.error)

    const page = pageResult.value
    const uuid = expectedId ?? this.extractIdFromUrl(conversationUrl)
    if (!uuid || uuid === 'unknown') {
      return err(new ParsingError(`Could not determine thread uuid from ${conversationUrl}`))
    }

    const rawResult = await fetchThreadById(page, uuid, DEFAULT_API_VERSION, {
      timeoutMs: this.currentTimeoutMs,
    })

    if (!rawResult.ok) {
      return err(this.classifyFetchError(rawResult.error))
    }

    const apiData = {
      entries: rawResult.value.entries ?? [],
      partial: false,
    }

    return this.parseConversationData(apiData, conversationUrl, uuid)
  }

  // ─── Page acquisition ────────────────────────────────────────────────────
  //
  // We need a page whose origin is perplexity.ai so that `credentials: 'include'`
  // inside page.evaluate(fetch(...)) actually sends the session cookies. The
  // discovery phase leaves one such page behind; if for some reason it isn't
  // there, fall back to a fresh navigation.

  private async getApiPage(): Promise<Result<Page, ExtractionErrorInstance>> {
    const pagesResult = await from(async () => this.context.pages())
    if (!pagesResult.ok) {
      return err(new ExtractionError(errorMessageOf(pagesResult.error)))
    }

    const pages = pagesResult.value
    const onPerplexity = pages.find((p) => p.url().startsWith('https://www.perplexity.ai'))
    if (onPerplexity) return ok(onPerplexity)

    const page = pages[0] ?? (await this.context.newPage())
    const navResult = await from(async () =>
      page.goto('https://www.perplexity.ai', { waitUntil: 'domcontentloaded' })
    )
    if (!navResult.ok) {
      return err(
        new ExtractionError(
          `Failed to establish perplexity.ai page: ${errorMessageOf(navResult.error)}`
        )
      )
    }

    return ok(page)
  }

  // ─── Error classification ────────────────────────────────────────────────

  private classifyFetchError(error: unknown): ConversationExtractorError {
    const msg = errorMessageOf(error)
    if (msg.includes('HTTP 404')) return new NotFoundError('Conversation not found (404)')
    if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
      return new AuthError('Authentication required or expired')
    }
    if (/HTTP 5\d\d/.test(msg)) return new ServerError(msg)
    return new NoDataError(msg)
  }

  // ─── Hashing ─────────────────────────────────────────────────────────────

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

  // ─── Parsing pipeline ────────────────────────────────────────────────────

  private parseConversationData(
    apiData: { entries: unknown[]; partial: boolean },
    conversationUrl: string,
    expectedId?: string
  ): Result<ExtractedConversation, ParsingErrorInstance> {
    const formattedEntries = this.ensureEntriesFormat(apiData.entries, conversationUrl)

    if (formattedEntries.length === 0) {
      this.diagnostics.writeFailure({
        url: conversationUrl,
        errorType: 'empty_entries',
      })
      logger.warn(`No parseable entries for ${conversationUrl}`)
      return err(new ParsingError('Failed to parse conversation data'))
    }

    const entriesValidationResult = z
      .array(ConversationExtractor.EntrySchema)
      .nonempty({ message: 'No valid entries found' })
      .safeParse(formattedEntries)

    if (!entriesValidationResult.success) {
      logger.warn(
        `Entry validation failed for ${conversationUrl}: ${entriesValidationResult.error.message}`
      )
      const paths = zodErrorPaths(entriesValidationResult)
      this.diagnostics.writeFailure({
        url: conversationUrl,
        errorType: 'zod_error',
        zodErrorDetails: paths,
      })
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

    const safeFilename = `${conversationId}-${slugify(title)}`
    assertSafeFilename(safeFilename)

    return ok({
      id: conversationId,
      title,
      spaceName,
      timestamp,
      content: markdownContent,
      contentHash,
      messages,
      safeFilename,
    })
  }

  private ensureEntriesFormat(data: unknown[], url: string): unknown[] {
    if (Array.isArray(data)) return data as unknown[]

    const dataObject = data as Record<string, unknown>
    if (dataObject && Array.isArray(dataObject.entries)) {
      return dataObject.entries as unknown[]
    }
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

      const answer = this.pickAnswerFromBlocks(entry.blocks ?? [])
      if (answer) {
        messages.push({ role: 'assistant', content: answer })
      }
    }

    return messages
  }

  /**
   * A single entry can contain several markdown-bearing blocks with the same
   * textual content:
   *
   *   - `ask_text_0_markdown` — the full answer, single chunk
   *   - `ask_text`            — the same answer, chunked into ~15-char pieces
   *
   * Both expose `markdown_block.answer`. Naively concatenating them duplicates
   * the entire answer. Prefer `ask_text_0_markdown`, fall back to `ask_text`,
   * then to whatever markdown block is present.
   */
  private pickAnswerFromBlocks(blocks: NonNullable<RawEntry['blocks']>): string {
    const withAnswer = blocks.filter((b) => b.markdown_block?.answer)
    if (withAnswer.length === 0) return ''

    const preferred =
      withAnswer.find((b) => b.intended_usage === 'ask_text_0_markdown') ??
      withAnswer.find((b) => b.intended_usage === 'ask_text') ??
      withAnswer[0]

    return preferred?.markdown_block?.answer?.trim() ?? ''
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
