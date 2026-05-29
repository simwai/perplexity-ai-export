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

    await page.goto(PERPLEXITY_LIBRARY_URL)
    await page.waitForLoadState('domcontentloaded')

    const activeApiVersion = await this.detectCurrentApiVersion(page)
    const discoveredConversations = await this.paginateAndFetchAllThreads(page, activeApiVersion)

    logger.success(`Discovered ${discoveredConversations.length} threads`)
    return discoveredConversations
  }

  private async detectCurrentApiVersion(page: Page): Promise<string> {
    const FALLBACK_API_VERSION = '2.18'

    try {
      const interceptedRequest = await page.waitForRequest(
        (request) => request.url().includes('/rest/thread/list_ask_threads'),
        { timeout: 5000 }
      )

      const requestUrl = interceptedRequest.url()
      const versionMatch = requestUrl.match(/[?&]version=([^&]+)/)

      const detectedVersion = versionMatch?.[1]
      if (detectedVersion) {
        logger.info(`Discovered API version: ${detectedVersion}`)
        return detectedVersion
      }

      logger.warn('Found list_ask_threads request but no version parameter, using fallback')
      return FALLBACK_API_VERSION
    } catch (_error) {
      logger.warn('No list_ask_threads request detected, using fallback version')
      return FALLBACK_API_VERSION
    }
  }

  private async paginateAndFetchAllThreads(
    page: Page,
    apiVersion: string
  ): Promise<ConversationMeta[]> {
    const BATCH_PAGE_SIZE = 20
    let currentOffset = 0
    const allDiscoveredConversations: ConversationMeta[] = []

    while (true) {
      const threadBatch = await this.fetchThreadBatchFromApi(
        page,
        apiVersion,
        currentOffset,
        BATCH_PAGE_SIZE
      )

      const isBatchEmpty = threadBatch.length === 0
      if (isBatchEmpty) {
        logger.info(`No more threads found at offset ${currentOffset}`)
        break
      }

      const formattedMetadata = this.mapRawBatchToMetadata(threadBatch)
      allDiscoveredConversations.push(...formattedMetadata)

      logger.info(`Fetched ${threadBatch.length} threads (offset ${currentOffset})`)
      currentOffset += BATCH_PAGE_SIZE

      await page.waitForTimeout(this.config.rateLimitMs)
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
          const apiPayload = { limit, ascending: false, offset, search_term: '' }

          const apiResponse = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(apiPayload),
          })

          const isResponseSuccessful = apiResponse.ok
          if (!isResponseSuccessful) {
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
