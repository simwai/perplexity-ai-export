import { type Page } from 'patchright'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'

const PERPLEXITY_BASE_URL = 'https://www.perplexity.ai'
const PERPLEXITY_LIBRARY_URL = `${PERPLEXITY_BASE_URL}/library`
const THREAD_BATCH_FETCH_LIMIT = 50
const PAGE_READY_CONFIRMATION_BUFFER_MILLISECONDS = 500

const API_VERSION_URL_PATTERNS = [
  '/rest/userinfo',
  '/rest/thread/list_ask_threads',
  '/rest/thread/list_pinned_ask_threads',
  '/rest/sidebar',
]

interface RawPerplexityThread {
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

function extractApiVersionFromUrl(targetUrl: string): string | null {
  const versionMatch = targetUrl.match(/[?&]version=([\d.]+)/)
  return versionMatch?.[1] ?? null
}

async function detectCurrentApiVersion(webPage: Page): Promise<string> {
  try {
    const apiResponse = await webPage.waitForResponse(
      (response) =>
        API_VERSION_URL_PATTERNS.some((pattern) => response.url().includes(pattern)) &&
        response.status() === 200,
      { timeout: 15_000 }
    )
    return extractApiVersionFromUrl(apiResponse.url()) ?? '2.18'
  } catch (detectionTimeout) {
    return '2.18'
  }
}

async function waitLibraryPageToBeReady(webPage: Page): Promise<void> {
  try {
    const userInfoEndpointPattern = '/rest/userinfo'
    await webPage.waitForResponse(
      (response) => response.url().includes(userInfoEndpointPattern) && response.status() === 200,
      { timeout: 12000 }
    )
  } catch (readyTimeout) {}
  await webPage.waitForTimeout(PAGE_READY_CONFIRMATION_BUFFER_MILLISECONDS)
}

async function fetchThreadBatch(
  webPage: Page,
  apiVersion: string,
  itemOffset: number
): Promise<{
  threads: RawPerplexityThread[]
  hasMoreThreads: boolean
  totalThreadsOnServer: number
}> {
  const fetchUrl = `${PERPLEXITY_BASE_URL}/rest/thread/list_ask_threads?version=${apiVersion}&source=default`

  const executionResult = await webPage.evaluate(
    async ({ url, offset, batchSize }) => {
      const response = await fetch(url, {
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
      return { httpStatus: response.status, responseBodyText: await response.text() }
    },
    { url: fetchUrl, offset: itemOffset, batchSize: THREAD_BATCH_FETCH_LIMIT }
  )

  const isSuccessfulResponse = executionResult.httpStatus === 200
  if (!isSuccessfulResponse) {
    errorBus.raiseError(`API error: ${executionResult.httpStatus}`, undefined, {
      body: executionResult.responseBodyText,
    })
  }

  let parsedResponseThreads: any
  try {
    parsedResponseThreads = JSON.parse(executionResult.responseBodyText)
  } catch (jsonParsingError) {
    errorBus.raiseError('Invalid JSON from API', jsonParsingError)
  }

  if (!Array.isArray(parsedResponseThreads)) {
    errorBus.raiseError('Expected array from API')
  }

  const threadList = parsedResponseThreads as RawPerplexityThread[]
  const totalCountFromServer = threadList[0]?.total_threads ?? threadList.length

  return {
    threads: threadList,
    hasMoreThreads: itemOffset + threadList.length < totalCountFromServer,
    totalThreadsOnServer: totalCountFromServer,
  }
}

export class LibraryDiscovery {
  async discoverAllConversationsFromLibrary(webPage: Page): Promise<ConversationMeta[]> {
    try {
      logger.info('Discovering threads...')
      const versionDetectionPromise = detectCurrentApiVersion(webPage)

      await webPage.goto(PERPLEXITY_LIBRARY_URL, { waitUntil: 'domcontentloaded' })
      await waitLibraryPageToBeReady(webPage)
      const currentApiVersion = await versionDetectionPromise

      let allDiscoveredThreads: RawPerplexityThread[] = []
      let currentItemOffset = 0
      let areMoreThreadsAvailable = true

      while (areMoreThreadsAvailable) {
        const isSubsequentBatch = currentItemOffset > 0
        if (isSubsequentBatch) {
          const randomizedJitterDelay = 800 + Math.random() * 700
          await webPage.waitForTimeout(randomizedJitterDelay)
        }

        const threadBatchResult = await fetchThreadBatch(
          webPage,
          currentApiVersion,
          currentItemOffset
        )
        allDiscoveredThreads.push(...threadBatchResult.threads)
        currentItemOffset += threadBatchResult.threads.length
        areMoreThreadsAvailable = threadBatchResult.hasMoreThreads

        logger.debug(
          `Fetched ${allDiscoveredThreads.length} / ${threadBatchResult.totalThreadsOnServer} threads`
        )
      }

      const conversationMetadataList = allDiscoveredThreads.map((thread) => ({
        ...thread,
        id: thread.uuid,
        url: `${PERPLEXITY_BASE_URL}/search/${thread.slug}`,
      }))

      logger.success(`Discovered ${conversationMetadataList.length} threads`)
      return conversationMetadataList
    } catch (discoveryError) {
      return errorBus.raiseError('Discovery failed', discoveryError)
    }
  }
}
