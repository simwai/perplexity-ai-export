import type { Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { DEFAULT_API_VERSION } from './api-version.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createNamedError } from '../utils/errors.js'
import { ok, err, type Result, from } from 'super-result'
import { z } from 'zod'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'

export const DiscoveryError = createNamedError('DiscoveryError')
export const ApiError = createNamedError('ApiError')

type DiscoveryErrorInstance = InstanceType<typeof DiscoveryError>
type ApiErrorInstance = InstanceType<typeof ApiError>

// #region Constants

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

// #endregion Constants

// #region Types

interface RawThread {
  uuid: string
  slug: string
  title: string
  last_query_datetime: string
  mode: string
  thread_number: number
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
  last_query_datetime: string
  mode: string
  thread_number: number
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

const RawThreadSchema = z
  .object({
    uuid: z.string(),
    slug: z.string(),
    title: z.string(),
    last_query_datetime: z.string(),
    mode: z.string(),
    thread_number: z.number(),
    context_uuid: z.string().optional(),
    frontend_uuid: z.string().optional(),
    frontend_context_uuid: z.string().optional(),
  })
  .passthrough()

// #endregion Types

// #region Helpers

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

async function evaluateThreadBatchInPage(
  page: Page,
  url: string,
  offset: number
): Promise<{ status: number; body: string }> {
  return page.evaluate(
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
      const text = await res.text()
      return { status: res.status, body: text }
    },
    { url, offset, batchSize: BATCH_SIZE }
  )
}

async function evaluatePinnedThreadsInPage(
  page: Page,
  url: string
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url }: { url: string }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      })
      const text = await res.text()
      return { status: res.status, body: text }
    },
    { url }
  )
}

// #endregion Helpers

// #region Version Detection

async function detectApiVersion(page: Page): Promise<Result<string, DiscoveryErrorInstance>> {
  const result = await detectVersionFromResponse(page)
  if (!result.ok) {
    logger.debug(`Version detection timeout — using fallback ${DEFAULT_API_VERSION}`)
    return ok(DEFAULT_API_VERSION)
  }
  return result
}

async function detectVersionFromResponse(
  page: Page
): Promise<Result<string, DiscoveryErrorInstance>> {
  try {
    const response = await page.waitForResponse(
      (res) => VERSIONED_URL_PATTERNS.some((p) => res.url().includes(p)) && res.status() === 200,
      { timeout: 15_000 }
    )
    const version = extractVersionFromUrl(response.url()) ?? DEFAULT_API_VERSION
    const pathname = new URL(response.url()).pathname
    logger.debug(`Detected API version: ${version} (from ${pathname})`)
    return ok(version)
  } catch (error) {
    return err(new DiscoveryError(error instanceof Error ? error.message : String(error)))
  }
}

// #endregion Version Detection

// #region Page Readiness

/**
 * Wait until the library page has finished its initialization network burst.
 * /rest/userinfo fires at library load, well after /api/auth/session, ensuring
 * cookies/CSRF are fully hydrated before we call list_ask_threads.
 */
async function waitForLibraryReady(
  page: Page,
  timeout = 12_000
): Promise<Result<void, DiscoveryErrorInstance>> {
  const result = await waitForUserInfoResponse(page, timeout)
  if (!result.ok) {
    logger.debug('waitForLibraryReady: timeout — proceeding anyway')
  }

  await page.waitForTimeout(PAGE_READY_BUFFER_MS)
  return result
}

async function waitForUserInfoResponse(
  page: Page,
  timeout: number
): Promise<Result<void, DiscoveryErrorInstance>> {
  const result = await from(
    async () =>
      await page.waitForResponse(
        (res) => res.url().includes('/rest/userinfo') && res.status() === 200,
        { timeout }
      )
  )

  if (!result.ok) {
    return err(
      new DiscoveryError(
        result.error instanceof Error ? result.error.message : String(result.error)
      )
    )
  }

  logger.debug('Library page ready (userinfo confirmed)')
  return ok(undefined)
}

// #endregion Page Readiness

// #region API Fetching

async function fetchThreadBatch(
  page: Page,
  version: string,
  offset: number,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<Result<ThreadBatchResponse, DiscoveryErrorInstance | ApiErrorInstance>> {
  const url = `${BASE_URL}/rest/thread/list_ask_threads?version=${version}&source=default`

  let rawResult: { status: number; body: string }
  try {
    rawResult = await evaluateThreadBatchInPage(page, url, offset)
  } catch (error) {
    return err(new DiscoveryError(error instanceof Error ? error.message : String(error)))
  }

  const raw = rawResult

  logger.debug(`list_ask_threads offset=${offset}: status=${raw.status}`)
  logger.debug(`list_ask_threads offset=${offset}: body=${raw.body.slice(0, 500)}`)

  if (raw.status !== 200) {
    return err(new ApiError(`list_ask_threads returned HTTP ${raw.status}`))
  }

  let parseResult: unknown
  try {
    parseResult = JSON.parse(raw.body)
  } catch (error) {
    return err(new ApiError(`list_ask_threads: invalid JSON — body: ${raw.body.slice(0, 200)}`))
  }

  const arrayValidated = z.array(RawThreadSchema).safeParse(parseResult)
  if (!arrayValidated.success) {
    const zodErrorPaths = arrayValidated.error.issues.map((issue) => issue.path.join('.'))
    diagnosticsWriter.writeFailure({
      url: `${BASE_URL}/rest/thread/list_ask_threads?version=${version}&source=default`,
      errorType: 'zod_error',
      zodErrorPaths,
    })
    return err(
      new ApiError(`list_ask_threads: schema validation failed — body: ${raw.body.slice(0, 200)}`)
    )
  }

  const threads = arrayValidated.data

  return ok({
    threads,
    hasMore: threads.length === BATCH_SIZE,
    total: 0,
  })
}

async function fetchPinnedThreads(
  page: Page,
  version: string,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<Result<RawThread[], DiscoveryErrorInstance | ApiErrorInstance>> {
  const url = `${BASE_URL}/rest/thread/list_pinned_ask_threads?version=${version}&source=default`

  let rawResult: { status: number; body: string }
  try {
    rawResult = await evaluatePinnedThreadsInPage(page, url)
  } catch (error) {
    return err(new DiscoveryError(error instanceof Error ? error.message : String(error)))
  }

  const raw = rawResult

  logger.debug(`list_pinned_ask_threads: status=${raw.status}`)

  if (raw.status !== 200) {
    logger.debug(`list_pinned_ask_threads returned HTTP ${raw.status} — skipping pinned`)
    return ok([])
  }

  let parseResult: unknown
  try {
    parseResult = JSON.parse(raw.body)
  } catch {
    logger.debug('list_pinned_ask_threads: invalid JSON — skipping pinned')
    return ok([])
  }

  const validated = z.array(RawThreadSchema).safeParse(parseResult)
  if (!validated.success) {
    const zodErrorPaths = validated.error.issues.map((issue) => issue.path.join('.'))
    diagnosticsWriter.writeFailure({
      url: `${BASE_URL}/rest/thread/list_pinned_ask_threads?version=${version}&source=default`,
      errorType: 'zod_error',
      zodErrorPaths,
    })
    logger.debug(`list_pinned_ask_threads: schema validation failed — skipping pinned`)
    return ok([])
  }

  return ok(validated.data)
}

async function fetchFirstBatch(
  page: Page,
  version: string,
  diagnosticsWriter: ApiDiagnosticsWriter
): Promise<Result<ThreadBatchResponse, DiscoveryErrorInstance | ApiErrorInstance>> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await fetchThreadBatch(page, version, 0, diagnosticsWriter)

    if (result.ok && result.value.threads.length > 0) {
      logger.debug(`First batch OK — ${result.value.threads.length} threads`)
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

// #endregion API Fetching

// #region Main Discovery

export class LibraryDiscovery {
  static readonly DiscoveryError = DiscoveryError
  static readonly ApiError = ApiError

  constructor(private readonly diagnosticsWriter: ApiDiagnosticsWriter) {}

  async discoverAllConversationsFromLibrary(
    page: Page
  ): Promise<Result<DiscoveredConversationMeta[], DiscoveryErrorInstance | ApiErrorInstance>> {
    logger.info('Discovering threads via REST API...')

    // Start version detection BEFORE navigation so we catch the first matching response
    const versionResult = await detectApiVersion(page)
    const version = versionResult.ok ? versionResult.value : DEFAULT_API_VERSION

    await this.navigateToLibrary(page)

    // Wait for page to be fully ready (userinfo fired + hydration buffer)
    await waitForLibraryReady(page)

    logger.info(`Detected API version: ${version}`)

    // Fetch pinned threads first (separate endpoint, no pagination)
    const pinnedResult = await fetchPinnedThreads(page, version, this.diagnosticsWriter)
    const pinnedThreads = pinnedResult.ok ? pinnedResult.value : []
    logger.debug(`Pinned threads: ${pinnedThreads.length}`)

    const allThreads: RawThread[] = []
    const firstBatchResult = await fetchFirstBatch(page, version, this.diagnosticsWriter)

    if (!firstBatchResult.ok) {
      if (pinnedThreads.length > 0) {
        logger.info(
          `No regular threads found; returning pinned threads only: ${errorMessageOf(firstBatchResult.error)}`
        )
        const conversations = pinnedThreads.map(rawThreadToConversationMeta)
        logger.success(`Discovered ${conversations.length} threads`)
        return ok(conversations)
      }
      return err(firstBatchResult.error)
    }

    const firstBatch = firstBatchResult.value
    allThreads.push(...firstBatch.threads)

    const remainingThreadsResult = await this.paginateRemainingBatches(page, version, firstBatch)
    if (!remainingThreadsResult.ok) {
      return err(remainingThreadsResult.error)
    }
    allThreads.push(...remainingThreadsResult.value)

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
  ): Promise<Result<RawThread[], DiscoveryErrorInstance>> {
    const remaining: RawThread[] = []
    let offset = firstBatch.threads.length
    let hasMore = firstBatch.hasMore
    let totalFetched = firstBatch.threads.length

    while (hasMore) {
      // Randomized delay to avoid Cloudflare triggers (from PR #12)
      const delay = MIN_DELAY_MS + Math.random() * JITTER_MS
      await page.waitForTimeout(delay)

      const batchResult = await fetchThreadBatch(page, version, offset, this.diagnosticsWriter)

      if (!batchResult.ok) {
        return err(batchResult.error as DiscoveryErrorInstance)
      }

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

// #endregion Main Discovery
