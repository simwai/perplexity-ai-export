import type { Page } from '@playwright/test'
import { logger } from '../utils/logging/logger.js'
import { DEFAULT_API_VERSION } from './api-version.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { BaseAppError } from '../utils/errors.js'
import { ok, err, type Result, from } from 'super-result'
import { z } from 'zod'
import { ApiDiagnosticsWriter } from '../utils/logging/api-diagnostics.js'

// ─── Errors ──────────────────────────────────────────────────────────────────

export class DiscoveryError extends BaseAppError {}
export class ApiError extends BaseAppError {}

type DiscoveryErrorInstance = InstanceType<typeof DiscoveryError>
type ApiErrorInstance = InstanceType<typeof ApiError>
export type DiscoveryApiError = DiscoveryErrorInstance | ApiErrorInstance

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.perplexity.ai'
const LIBRARY_URL = `${BASE_URL}/library`
const BATCH_SIZE = 50
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1500
const PAGE_READY_BUFFER_MS = 500

// why: base delay + jitter prevents hitting rate limits; values from PR #12 tuning
const MIN_DELAY_MS = 800
const JITTER_MS = 700

/**
 * Only capture API version from endpoints that fire AFTER the library page
 * is fully initialized. /api/auth/session is intentionally excluded — it fires
 * too early (before cookies/CSRF are hydrated) and causes list_ask_threads
 * to return [].
 */
const VERSIONED_URL_PATTERNS = [
  '/rest/userinfo',
  '/rest/thread/list_ask_threads',
  '/rest/thread/list_pinned_ask_threads',
  '/rest/sidebar',
]

/**
 * supported_block_use_cases — copied verbatim from a real browser request.
 * Missing cases cause the server to omit the corresponding block (e.g.
 * `workflow_root` disappears without `workflow_steps` + `workflow_widgets`).
 */
const SUPPORTED_BLOCK_USE_CASES = [
  'answer_modes',
  'media_items',
  'inline_entity_cards',
  'place_widgets',
  'finance_widgets',
  'sports_widgets',
  'news_widgets',
  'shopping_widgets',
  'jobs_widgets',
  'search_result_widgets',
  'inline_images',
  'inline_assets',
  'placeholder_cards',
  'diff_blocks',
  'entity_group_v2',
  'refinement_filters',
  'canvas_mode',
  'maps_preview',
  'answer_tabs',
  'price_comparison_widgets',
  'preserve_latex',
  'generic_onboarding_widgets',
  'in_context_suggestions',
  'pending_followups',
  'inline_claims',
  'unified_assets',
  'workflow_steps',
  'workflow_widgets',
  'navigation_results',
  'background_agents',
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

interface Collection {
  uuid: string
  title: string
  emoji: string
  slug: string
}

interface RawThread {
  uuid: string
  slug: string
  title: string
  query_str?: string
  first_answer?: string
  answer_preview?: string
  last_query_datetime?: string
  mode?: string
  status?: string
  display_model?: string
  thread_access?: number
  has_next_page?: boolean
  total_threads?: number
  collection?: Collection | null
  sources?: string[]
  query_count?: number
  search_focus?: string
  thread_number?: number
  context_uuid?: string
  frontend_uuid?: string
  frontend_context_uuid?: string
  [key: string]: unknown
}

export interface DiscoveredConversationMeta {
  id: string
  url: string
  uuid: string
  slug: string
  title: string
  query_str?: string
  first_answer?: string
  answer_preview?: string
  last_query_datetime?: string
  mode?: string
  status?: string
  display_model?: string
  thread_access?: number
  collection?: Collection | null
  sources?: string[]
  query_count?: number
  search_focus?: string
  thread_number?: number
  context_uuid?: string
  frontend_uuid?: string
  frontend_context_uuid?: string
  [key: string]: unknown
}

interface ThreadBatchResponse {
  threads: RawThread[]
  hasMore: boolean
  total: number
}

/** Response shape of GET /rest/thread/{uuid} — consumed by the extractor. */
export interface RawThreadResponse {
  entries: unknown[]
  first_entry: unknown | null
  thread_metadata: unknown
  status: string
  [key: string]: unknown
}

const RawThreadSchema = z
  .object({
    uuid: z.string(),
    slug: z.string(),
    title: z.string(),
    query_str: z.string().optional(),
    first_answer: z.string().optional(),
    answer_preview: z.string().optional(),
    last_query_datetime: z.string().optional(),
    mode: z.string().optional(),
    status: z.string().optional(),
    display_model: z.string().optional(),
    thread_access: z.number().optional(),
    has_next_page: z.boolean().optional(),
    total_threads: z.number().optional(),
    collection: z.unknown().nullable().optional(),
    sources: z.array(z.string()).optional(),
    query_count: z.number().optional(),
    search_focus: z.string().optional(),
    thread_number: z.number().optional(),
    context_uuid: z.string().optional(),
    frontend_uuid: z.string().optional(),
    frontend_context_uuid: z.string().optional(),
  })
  .passthrough()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVersionFromUrl(url: string): string | null {
  const match = url.match(/[?&]version=([\d.]+)/)
  return match?.[1] ?? null
}

function rawThreadToConversationMeta(thread: RawThread): DiscoveredConversationMeta {
  return {
    ...thread,
    id: thread.uuid,
    url: `${BASE_URL}/search/${thread.slug}`,
  }
}

// ─── Version Detection ───────────────────────────────────────────────────────

async function detectApiVersion(page: Page): Promise<Result<string, DiscoveryErrorInstance>> {
  const result = await from(async () => {
    const response = await page.waitForResponse(
      (res) => VERSIONED_URL_PATTERNS.some((p) => res.url().includes(p)) && res.status() === 200,
      { timeout: 15_000 }
    )
    const version = extractVersionFromUrl(response.url()) ?? DEFAULT_API_VERSION
    const pathname = new URL(response.url()).pathname
    logger.debug(`Detected API version: ${version} (from ${pathname})`)
    return version
  })

  if (!result.ok) {
    logger.debug(`Version detection timeout — using fallback ${DEFAULT_API_VERSION}`)
    return ok(DEFAULT_API_VERSION)
  }
  return ok(result.value)
}

// ─── Page Readiness ──────────────────────────────────────────────────────────

/**
 * Wait until the library page has finished its initialization network burst.
 * /rest/userinfo fires at library load, well after /api/auth/session, ensuring
 * cookies/CSRF are fully hydrated before we call list_ask_threads.
 */
async function waitForLibraryReady(page: Page, timeout = 12_000): Promise<void> {
  try {
    await page.waitForResponse(
      (res) => res.url().includes('/rest/userinfo') && res.status() === 200,
      { timeout }
    )
    logger.debug('Library page ready (userinfo confirmed)')
  } catch {
    logger.debug('waitForLibraryReady: timeout — proceeding anyway')
  }

  await page.waitForTimeout(PAGE_READY_BUFFER_MS)
}

// ─── API Fetching ────────────────────────────────────────────────────────────

async function fetchThreadBatch(
  page: Page,
  version: string,
  offset: number,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<Result<ThreadBatchResponse, DiscoveryApiError>> {
  const url = `${BASE_URL}/rest/thread/list_ask_threads?version=${version}&source=default`

  const rawResult = await from(async () =>
    page.evaluate(
      async ({ url, offset, batchSize }: { url: string; offset: number; batchSize: number }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            limit: batchSize,
            offset,
            ascending: false,
            include_assets: true,
            search_term: '',
            send_last_entry: true,
            thread_type_filter: null,
            with_temporary_threads: false,
          }),
          credentials: 'include',
        })
        return { status: res.status, body: await res.text() }
      },
      { url, offset, batchSize: BATCH_SIZE }
    )
  )

  if (!rawResult.ok) {
    return err(new ApiError(errorMessageOf(rawResult.error)))
  }

  const { status, body } = rawResult.value

  logger.debug(`list_ask_threads offset=${offset}: status=${status}`)
  logger.debug(`list_ask_threads offset=${offset}: body=${body.slice(0, 500)}`)

  if (status !== 200) {
    return err(new ApiError(`list_ask_threads returned HTTP ${status}`))
  }

  const parseResult = from(() => JSON.parse(body))
  if (!parseResult.ok) {
    diagnosticsWriter.writeFailure({ url, errorType: 'unknown_shape' })
    return err(new ApiError(`list_ask_threads: invalid JSON — body: ${body.slice(0, 200)}`))
  }

  const validated = z.array(RawThreadSchema).safeParse(parseResult.value)
  if (!validated.success) {
    const zodErrorPaths = validated.error.issues.map((issue) => issue.path.join('.'))
    diagnosticsWriter.writeFailure({ url, errorType: 'zod_error', zodErrorPaths })
    return err(
      new ApiError(
        `list_ask_threads: schema validation failed — paths: ${zodErrorPaths.join(', ')}`
      )
    )
  }

  const threads = validated.data as RawThread[]
  const total = threads[0]?.total_threads ?? 0

  return ok({
    threads,
    // Stop only when the API returns a partial page — avoids relying on
    // total_threads which may be server-capped (observed cap: 100).
    hasMore: threads.length === BATCH_SIZE,
    total,
  })
}

/**
 * Pinned threads are optional. Any failure here is tolerated (returns []) but
 * still recorded in diagnostics.
 */
async function fetchPinnedThreads(
  page: Page,
  version: string,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<RawThread[]> {
  const url = `${BASE_URL}/rest/thread/list_pinned_ask_threads?version=${version}&source=default`

  const rawResult = await from(async () =>
    page.evaluate(
      async ({ url }: { url: string }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include',
        })
        return { status: res.status, body: await res.text() }
      },
      { url }
    )
  )

  if (!rawResult.ok) {
    logger.debug('list_pinned_ask_threads: evaluate failed — skipping pinned')
    return []
  }

  const { status, body } = rawResult.value
  logger.debug(`list_pinned_ask_threads: status=${status}`)

  if (status !== 200) {
    logger.debug(`list_pinned_ask_threads returned HTTP ${status} — skipping pinned`)
    return []
  }

  const parseResult = from(() => JSON.parse(body))
  if (!parseResult.ok) {
    diagnosticsWriter.writeFailure({ url, errorType: 'unknown_shape' })
    logger.debug('list_pinned_ask_threads: invalid JSON — skipping pinned')
    return []
  }

  const validated = z.array(RawThreadSchema).safeParse(parseResult.value)
  if (!validated.success) {
    const zodErrorPaths = validated.error.issues.map((issue) => issue.path.join('.'))
    diagnosticsWriter.writeFailure({ url, errorType: 'zod_error', zodErrorPaths })
    logger.debug('list_pinned_ask_threads: schema validation failed — skipping pinned')
    return []
  }

  return validated.data as RawThread[]
}

/**
 * Retries only on "200 OK but empty array". Real API errors (401, 500, invalid
 * JSON, schema mismatch) propagate immediately.
 */
async function fetchFirstBatch(
  page: Page,
  version: string,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<Result<ThreadBatchResponse, DiscoveryApiError>> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await fetchThreadBatch(page, version, 0, diagnosticsWriter)

    if (!result.ok) return err(result.error)

    if (result.value.threads.length > 0) {
      logger.debug(
        `First batch OK — ${result.value.threads.length} threads (total: ${result.value.total})`
      )
      return ok(result.value)
    }

    if (attempt < MAX_RETRIES) {
      logger.debug(`Attempt ${attempt}: empty batch, retrying in ${RETRY_DELAY_MS}ms…`)
      await page.waitForTimeout(RETRY_DELAY_MS)
    }
  }

  return err(
    new DiscoveryError(
      `list_ask_threads returned empty after ${MAX_RETRIES} attempts — API may be unavailable or the library is empty`
    )
  )
}

// ─── Main Discovery ──────────────────────────────────────────────────────────

export class LibraryDiscovery {
  constructor(private readonly diagnosticsWriter: ApiDiagnosticsWriter) {}

  async discoverAllConversationsFromLibrary(
    page: Page
  ): Promise<Result<DiscoveredConversationMeta[], DiscoveryApiError>> {
    logger.info('Discovering threads via REST API...')

    // Start version detection BEFORE navigation so we catch the first
    // matching response. The promise is started here and awaited AFTER
    // navigation + readiness wait.
    const versionPromise = detectApiVersion(page)

    await this.navigateToLibrary(page)
    await waitForLibraryReady(page)

    const versionResult = await versionPromise
    const version = versionResult.ok ? versionResult.value : DEFAULT_API_VERSION
    logger.info(`Detected API version: ${version}`)

    const pinnedThreads = await fetchPinnedThreads(page, version, this.diagnosticsWriter)
    logger.debug(`Pinned threads: ${pinnedThreads.length}`)

    const firstBatchResult = await fetchFirstBatch(page, version, this.diagnosticsWriter)

    if (!firstBatchResult.ok) {
      if (pinnedThreads.length > 0) {
        logger.info(
          `No regular threads found; returning pinned threads only: ${errorMessageOf(
            firstBatchResult.error
          )}`
        )
        const conversations = pinnedThreads.map(rawThreadToConversationMeta)
        logger.success(`Discovered ${conversations.length} threads`)
        return ok(conversations)
      }
      return err(firstBatchResult.error)
    }

    const firstBatch = firstBatchResult.value
    const allThreads: RawThread[] = [...firstBatch.threads]

    logger.debug(`Total threads on server: ${firstBatch.total}`)

    const remainingResult = await this.paginateRemainingBatches(page, version, firstBatch)
    if (!remainingResult.ok) return err(remainingResult.error)
    allThreads.push(...remainingResult.value)

    const conversations = this.mergeAndDeduplicateThreads(pinnedThreads, allThreads)
    logger.success(`Discovered ${conversations.length} threads`)
    return ok(conversations)
  }

  private async navigateToLibrary(page: Page): Promise<void> {
    await page.goto(LIBRARY_URL, { waitUntil: 'domcontentloaded' })
  }

  private async paginateRemainingBatches(
    page: Page,
    version: string,
    firstBatch: ThreadBatchResponse
  ): Promise<Result<RawThread[], DiscoveryApiError>> {
    const remaining: RawThread[] = []
    let offset = firstBatch.threads.length
    let hasMore = firstBatch.hasMore
    let totalFetched = firstBatch.threads.length

    while (hasMore) {
      // Randomized delay to avoid Cloudflare triggers (from PR #12)
      const delay = MIN_DELAY_MS + Math.random() * JITTER_MS
      await page.waitForTimeout(delay)

      const batchResult = await fetchThreadBatch(page, version, offset, this.diagnosticsWriter)
      if (!batchResult.ok) return err(batchResult.error)

      const batch = batchResult.value
      remaining.push(...batch.threads)
      totalFetched += batch.threads.length
      offset += batch.threads.length
      hasMore = batch.hasMore

      logger.debug(`Fetched ${totalFetched} threads`)
    }

    return ok(remaining)
  }

  private mergeAndDeduplicateThreads(
    pinnedThreads: RawThread[],
    allThreads: RawThread[]
  ): DiscoveredConversationMeta[] {
    // uuid is guaranteed by RawThreadSchema, so no uuid-less handling needed.
    const seen = new Set<string>()
    const merged: RawThread[] = []

    for (const thread of [...pinnedThreads, ...allThreads]) {
      if (!seen.has(thread.uuid)) {
        seen.add(thread.uuid)
        merged.push(thread)
      }
    }

    return merged.map(rawThreadToConversationMeta)
  }
}

// ─── Single-Thread Fetch (used by ConversationExtractor) ─────────────────────
//
// Calls GET /rest/thread/{uuid} directly via the page's authenticated context.
// This replaces the previous approach of navigating to /search/{slug} and
// racing the SPA response — the endpoint is the same one the SPA fires
// underneath, and calling it directly removes the hydration race entirely.
//
// In a larger project this would live in its own `rest/` module. Kept here
// alongside discovery because both are the only consumers of the API version.

export interface FetchThreadOptions {
  /** Abort the underlying fetch after this many ms. Default 30_000. */
  timeoutMs?: number
}

export async function fetchThreadById(
  page: Page,
  uuid: string,
  version: string,
  options: FetchThreadOptions = {}
): Promise<Result<RawThreadResponse, ApiErrorInstance>> {
  const { timeoutMs = 30_000 } = options

  const params = new URLSearchParams({
    with_parent_info: 'true',
    with_schematized_response: 'true',
    version,
    source: 'default',
    limit: '20',
    offset: '0',
    from_first: 'false',
    with_first_entry: 'true',
    with_latest_entry: 'false',
  })
  for (const useCase of SUPPORTED_BLOCK_USE_CASES) {
    params.append('supported_block_use_cases', useCase)
  }

  const url = `${BASE_URL}/rest/thread/${uuid}?${params.toString()}`

  const rawResult = await from(async () =>
    page.evaluate(
      async ({ url, version, timeoutMs }: { url: string; version: string; timeoutMs: number }) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              accept: '*/*',
              'x-app-apiclient': 'default',
              'x-app-apiversion': version,
              'x-perplexity-request-reason': 'search-components',
            },
            credentials: 'include',
            signal: controller.signal,
          })
          return { status: res.status, body: await res.text() }
        } catch (e) {
          return { status: -1, body: String(e) }
        } finally {
          clearTimeout(timer)
        }
      },
      { url, version, timeoutMs }
    )
  )

  if (!rawResult.ok) {
    return err(new ApiError(errorMessageOf(rawResult.error)))
  }

  const { status, body } = rawResult.value
  logger.debug(`fetchThread ${uuid}: status=${status}`)

  if (status === -1) {
    return err(new ApiError(`fetchThread ${uuid}: aborted after ${timeoutMs}ms — ${body}`))
  }
  if (status !== 200) {
    return err(new ApiError(`fetchThread ${uuid}: HTTP ${status}`))
  }

  const parseResult = from(() => JSON.parse(body) as RawThreadResponse)
  if (!parseResult.ok) {
    return err(new ApiError(`fetchThread ${uuid}: invalid JSON`))
  }

  return ok(parseResult.value)
}
