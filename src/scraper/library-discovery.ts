import type { Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { DEFAULT_API_VERSION } from './api-version.js'

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.perplexity.ai'
const LIBRARY_URL = `${BASE_URL}/library`
const BATCH_SIZE = 50
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1500
const PAGE_READY_BUFFER_MS = 500

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawThread {
  uuid: string
  slug: string
  title: string
  query_str: string
  first_answer: string
  answer_preview: string
  last_query_datetime: string
  mode: string
  status: string
  display_model: string
  thread_access: number
  has_next_page: boolean
  total_threads: number
  collection: Collection | null
  sources: string[]
  query_count: number
  search_focus: string
  [key: string]: unknown
}

interface Collection {
  uuid: string
  title: string
  emoji: string
  slug: string
}

export interface ConversationMeta {
  id: string
  url: string
  uuid: string
  slug: string
  title: string
  query_str: string
  first_answer: string
  answer_preview: string
  last_query_datetime: string
  mode: string
  status: string
  display_model: string
  thread_access: number
  collection: Collection | null
  sources: string[]
  query_count: number
  search_focus: string
  [key: string]: unknown
}

interface ThreadBatchResponse {
  threads: RawThread[]
  hasMore: boolean
  total: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVersionFromUrl(url: string): string | null {
  const match = url.match(/[?&]version=([\d.]+)/)
  return match?.[1] ?? null
}

function rawThreadToConversationMeta(thread: RawThread): ConversationMeta {
  return {
    ...thread,
    id: thread.uuid,
    url: `${BASE_URL}/search/${thread.slug}`,
  }
}

// ─── Version Detection ────────────────────────────────────────────────────────

async function detectApiVersion(page: Page): Promise<string> {
  try {
    const response = await page.waitForResponse(
      (res) => VERSIONED_URL_PATTERNS.some((p) => res.url().includes(p)) && res.status() === 200,
      { timeout: 15_000 }
    )
    const version = extractVersionFromUrl(response.url()) ?? DEFAULT_API_VERSION
    const pathname = new URL(response.url()).pathname
    logger.debug(`Detected API version: ${version} (from ${pathname})`)
    return version
  } catch {
    logger.debug(`Version detection timeout — using fallback ${DEFAULT_API_VERSION}`)
    return DEFAULT_API_VERSION
  }
}

// ─── Page Readiness ───────────────────────────────────────────────────────────

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

// ─── API Fetching ─────────────────────────────────────────────────────────────

async function fetchThreadBatch(
  page: Page,
  version: string,
  offset: number
): Promise<ThreadBatchResponse> {
  const url = `${BASE_URL}/rest/thread/list_ask_threads?version=${version}&source=default`

  const raw = await page.evaluate(
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

  logger.debug(`list_ask_threads offset=${offset}: status=${raw.status}`)
  logger.debug(`list_ask_threads offset=${offset}: body=${raw.body.slice(0, 500)}`)

  if (raw.status !== 200) {
    throw new LibraryDiscovery.ApiError(`list_ask_threads returned HTTP ${raw.status}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.body)
  } catch {
    throw new LibraryDiscovery.ApiError(`list_ask_threads: invalid JSON — body: ${raw.body.slice(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new LibraryDiscovery.ApiError(`list_ask_threads: expected array, got ${typeof parsed}`)
  }

  const threads = parsed as RawThread[]
  const total = threads[0]?.total_threads ?? 0

  return {
    threads,
    // Stop only when the API returns a partial page — avoids relying on
    // total_threads which may be server-capped (observed cap: 100).
    hasMore: threads.length === BATCH_SIZE,
    total,
  }
}

async function fetchPinnedThreads(page: Page, version: string): Promise<RawThread[]> {
  const url = `${BASE_URL}/rest/thread/list_pinned_ask_threads?version=${version}&source=default`

  const raw = await page.evaluate(
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

  logger.debug(`list_pinned_ask_threads: status=${raw.status}`)

  if (raw.status !== 200) {
    logger.debug(`list_pinned_ask_threads returned HTTP ${raw.status} — skipping pinned`)
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.body)
  } catch {
    logger.debug('list_pinned_ask_threads: invalid JSON — skipping pinned')
    return []
  }

  if (!Array.isArray(parsed)) {
    logger.debug(`list_pinned_ask_threads: expected array, got ${typeof parsed} — skipping pinned`)
    return []
  }

  return parsed as RawThread[]
}

async function fetchFirstBatch(page: Page, version: string): Promise<ThreadBatchResponse> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await fetchThreadBatch(page, version, 0)

    if (result.threads.length > 0) {
      logger.debug(`First batch OK — ${result.threads.length} threads (total: ${result.total})`)
      return result
    }

    if (attempt < MAX_RETRIES) {
      logger.debug(`Attempt ${attempt}: empty batch, retrying in ${RETRY_DELAY_MS}ms…`)
      await page.waitForTimeout(RETRY_DELAY_MS)
    }
  }

  throw new LibraryDiscovery.DiscoveryError(
    `list_ask_threads returned empty after ${MAX_RETRIES} attempts — API may be unavailable or the library is empty`
  )
}

// ─── Main Discovery ───────────────────────────────────────────────────────────

export class LibraryDiscovery {
  static readonly DiscoveryError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'DiscoveryError'
    }
  }

  static readonly ApiError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ApiError'
    }
  }

  async discoverAllConversationsFromLibrary(page: Page): Promise<ConversationMeta[]> {
    logger.info('Discovering threads via REST API...')

    // Start version detection BEFORE navigation so we catch the first matching response
    const versionPromise = detectApiVersion(page)

    // Navigate to library
    await page.goto(LIBRARY_URL, { waitUntil: 'domcontentloaded' })

    // Wait for page to be fully ready (userinfo fired + hydration buffer)
    await waitForLibraryReady(page)

    // Resolve detected version (fallback to default API version on timeout)
    const version = await versionPromise
    logger.info(`Detected API version: ${version}`)

    // Fetch pinned threads first (separate endpoint, no pagination)
    const pinnedThreads = await fetchPinnedThreads(page, version)
    logger.debug(`Pinned threads: ${pinnedThreads.length}`)

    // First batch with retry logic
    const allThreads: RawThread[] = []
    let firstBatch: ThreadBatchResponse

    try {
      firstBatch = await fetchFirstBatch(page, version)
    } catch (err) {
      if (pinnedThreads.length > 0) {
        // Pinned-only library — not an error
        logger.info('No regular threads found; returning pinned threads only')
        const conversations = pinnedThreads.map(rawThreadToConversationMeta)
        logger.success(`Discovered ${conversations.length} threads`)
        return conversations
      }
      throw err
    }

    allThreads.push(...firstBatch.threads)

    logger.debug(`Total threads on server: ${firstBatch.total}`)

    // Paginate remaining batches
    let offset = firstBatch.threads.length
    let hasMore = firstBatch.hasMore

    while (hasMore) {
      // Randomized delay to avoid Cloudflare triggers (from PR #12)
      const delay = 800 + Math.random() * 700
      await page.waitForTimeout(delay)

      const batch = await fetchThreadBatch(page, version, offset)
      allThreads.push(...batch.threads)
      offset += batch.threads.length
      hasMore = batch.hasMore

      logger.debug(`Fetched ${allThreads.length} threads`)
    }

    // Merge pinned + regular, deduplicate by uuid
    const seen = new Set<string>()
    const merged: RawThread[] = []

    for (const thread of [...pinnedThreads, ...allThreads]) {
      if (!seen.has(thread.uuid)) {
        seen.add(thread.uuid)
        merged.push(thread)
      }
    }

    const conversations = merged.map(rawThreadToConversationMeta)
    logger.success(`Discovered ${conversations.length} threads`)
    return conversations
  }
}
