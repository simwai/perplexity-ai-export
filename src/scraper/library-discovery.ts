import { type Page } from 'patchright'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'

const BASE_URL = 'https://www.perplexity.ai'
const LIBRARY_URL = `${BASE_URL}/library`
const BATCH_SIZE = 50
const PAGE_READY_BUFFER_MS = 500

const VERSIONED_URL_PATTERNS = [
  '/rest/userinfo',
  '/rest/thread/list_ask_threads',
  '/rest/thread/list_pinned_ask_threads',
  '/rest/sidebar',
]

interface RawThread {
  uuid: string
  slug: string
  title: string
  query_str: string
  total_threads: number
  collection: { title: string } | null
  [key: string]: unknown
}

export interface ConversationMeta {
  id: string
  url: string
  [key: string]: unknown
}

function extractVersion(url: string): string | null {
  const match = url.match(/[?&]version=([\d.]+)/)
  return match?.[1] ?? null
}

async function detectVersion(page: Page): Promise<string> {
  try {
    const res = await page.waitForResponse(
      (r) => VERSIONED_URL_PATTERNS.some((p) => r.url().includes(p)) && r.status() === 200,
      { timeout: 15_000 }
    )
    return extractVersion(res.url()) ?? '2.18'
  } catch {
    return '2.18'
  }
}

async function waitReady(page: Page): Promise<void> {
  try {
    await page.waitForResponse((r) => r.url().includes('/rest/userinfo') && r.status() === 200, { timeout: 12000 })
  } catch {}
  await page.waitForTimeout(PAGE_READY_BUFFER_MS)
}

async function fetchBatch(page: Page, version: string, offset: number): Promise<{ threads: RawThread[], hasMore: boolean, total: number }> {
  const url = `${BASE_URL}/rest/thread/list_ask_threads?version=${version}&source=default`
  const raw = await page.evaluate(async ({ url, offset, batchSize }) => {
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
  }, { url, offset, batchSize: BATCH_SIZE })

  if (raw.status !== 200) errorBus.raiseError(`API error: ${raw.status}`, undefined, { body: raw.body })

  let parsed: any
  try { parsed = JSON.parse(raw.body) } catch (e) { errorBus.raiseError('Invalid JSON from API', e) }
  if (!Array.isArray(parsed)) errorBus.raiseError('Expected array from API')

  const threads = parsed as RawThread[]
  const total = threads[0]?.total_threads ?? threads.length
  return { threads, hasMore: offset + threads.length < total, total }
}

export class LibraryDiscovery {
  async discoverAllConversationsFromLibrary(page: Page): Promise<ConversationMeta[]> {
    try {
      logger.info('Discovering threads...')
      const vPromise = detectVersion(page)
      await page.goto(LIBRARY_URL, { waitUntil: 'domcontentloaded' })
      await waitReady(page)
      const version = await vPromise

      let all: RawThread[] = []
      let offset = 0
      let hasMore = true

      while (hasMore) {
        if (offset > 0) await page.waitForTimeout(800 + Math.random() * 700)
        const batch = await fetchBatch(page, version, offset)
        all.push(...batch.threads)
        offset += batch.threads.length
        hasMore = batch.hasMore
        logger.debug(`Fetched ${all.length} / ${batch.total} threads`)
      }

      const convs = all.map(t => ({ ...t, id: t.uuid, url: `${BASE_URL}/search/${t.slug}` }))
      logger.success(`Discovered ${convs.length} threads`)
      return convs
    } catch (e) {
      return errorBus.raiseError('Discovery failed', e)
    }
  }
}
