import { type Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import { type ConversationMeta } from './checkpoint-manager.js'
import { type Config } from '../utils/config.js'

export class LibraryDiscovery {
  static readonly VersionCaptureError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VersionCaptureError'
    }
  }

  static readonly PaginationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'PaginationError'
    }
  }

  static readonly NoDataError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NoDataError'
    }
  }

  constructor(private readonly config: Config) {}

  async discoverAllConversationsFromLibrary(page: Page): Promise<ConversationMeta[]> {
    const PERPLEXITY_LIBRARY_URL = 'https://www.perplexity.ai/library'
    logger.info('Discovering threads via REST API...')

    const versionPromise = this.detectCurrentApiVersion(page)
    await page.goto(PERPLEXITY_LIBRARY_URL)
    await page.waitForLoadState('domcontentloaded')

    const activeApiVersion = await versionPromise
    const discoveredConversations = await this.paginateAndFetchAllThreads(page, activeApiVersion)

    logger.success(`Discovered ${discoveredConversations.length} threads`)
    return discoveredConversations
  }

  private async detectCurrentApiVersion(page: Page): Promise<string> {
    const FALLBACK_API_VERSION = '2.18'
    const VERSION_PARAM_REGEX = /[?&]version=([^&]+)/
    const VERSIONED_URL_PATTERNS = [
      '/api/auth/session', // fires on every page load — most reliable
      '/rest/collections/list_recent',
      '/rest/thread/list_ask_threads',
    ]

    try {
      const interceptedRequest = await page.waitForRequest(
        (request) => {
          const url = request.url()
          return (
            VERSIONED_URL_PATTERNS.some((pattern) => url.includes(pattern)) &&
            VERSION_PARAM_REGEX.test(url)
          )
        },
        { timeout: 8000 }
      )

      const detectedVersion = interceptedRequest.url().match(VERSION_PARAM_REGEX)?.[1]
      if (detectedVersion) {
        const url = new URL(interceptedRequest.url())
        logger.info(`Detected API version: ${detectedVersion} (from ${url.pathname})`)
        return detectedVersion
      }

      logger.warn('Versioned request matched but no version param found, using fallback')
      return FALLBACK_API_VERSION
    } catch (_error) {
      logger.warn('No versioned request detected within timeout, using fallback')
      return FALLBACK_API_VERSION
    }
  }

  private async paginateAndFetchAllThreads(
    page: Page,
    apiVersion: string
  ): Promise<ConversationMeta[]> {
    const BATCH_PAGE_SIZE = 20
    const allDiscoveredConversations: ConversationMeta[] = []

    // Fetch first batch to get total threads
    const firstBatch = await this.fetchThreadBatchFromApi(page, apiVersion, 0, BATCH_PAGE_SIZE)

    if (firstBatch.length === 0) {
      logger.info('No threads found in library')
      return []
    }

    const firstItem = firstBatch[0] as { total_threads?: number }
    const totalThreads = firstItem.total_threads ?? firstBatch.length
    const totalBatches = Math.ceil(totalThreads / BATCH_PAGE_SIZE)

    logger.info(`Detected ${totalThreads} total threads (${totalBatches} batches)`)

    const formattedFirstBatch = this.mapRawBatchToMetadata(firstBatch)
    allDiscoveredConversations.push(...formattedFirstBatch)
    logger.info(`Fetched batch 1/${totalBatches} (offset 0)`)

    // Fetch remaining batches
    for (let batchIndex = 1; batchIndex < totalBatches; batchIndex++) {
      await page.waitForTimeout(this.config.rateLimitMs)
      const offset = batchIndex * BATCH_PAGE_SIZE

      const threadBatch = await this.fetchThreadBatchFromApi(
        page,
        apiVersion,
        offset,
        BATCH_PAGE_SIZE
      )

      const formattedMetadata = this.mapRawBatchToMetadata(threadBatch)
      allDiscoveredConversations.push(...formattedMetadata)

      logger.info(`Fetched batch ${batchIndex + 1}/${totalBatches} (offset ${offset})`)
    }

    return allDiscoveredConversations
  }

  private async fetchThreadBatchFromApi(
    page: Page,
    apiVersion: string,
    offset: number,
    limit: number
  ): Promise<unknown[]> {
    try {
      return await page.evaluate(
        async ({ offset, limit, version }) => {
          const apiEndpoint = `/rest/thread/list_ask_threads?version=${version}&source=default`
          const apiPayload = { limit, offset }

          const apiResponse = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(apiPayload),
          })

          const isResponseSuccessful = apiResponse.ok
          if (!isResponseSuccessful) {
            if (apiResponse.status === 400 || apiResponse.status === 404) {
              return [] // signals "no more pages" — loop breaks cleanly
            }
            throw new Error(`API responded with ${apiResponse.status}`)
          }

          const responseJson = await apiResponse.json()
          const isJsonArray = Array.isArray(responseJson)
          return isJsonArray ? responseJson : []
        },
        { offset, limit, version: apiVersion }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new LibraryDiscovery.PaginationError(
        `Failed to fetch batch at offset ${offset}: ${errorMessage}`
      )
    }
  }

  private mapRawBatchToMetadata(batch: unknown[]): ConversationMeta[] {
    return batch
      .filter((item): item is { slug: string } => this.isMinimumRequiredThreadDataPresent(item))
      .map((item) => ({
        id: item.slug,
        url: `https://www.perplexity.ai/search/${item.slug}`,
      }))
  }

  private isMinimumRequiredThreadDataPresent(item: unknown): boolean {
    const isObject = item && typeof item === 'object'
    const hasSlug = isObject && 'slug' in item && typeof (item as any).slug === 'string'
    return !!hasSlug
  }
}
