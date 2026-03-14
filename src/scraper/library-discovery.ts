import type { Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import type { ConversationMetadata } from './checkpoint-manager.js'

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

  async discoverAllConversationsFromLibrary(page: Page): Promise<ConversationMetadata[]> {
    const perplexityLibraryUrl = 'https://www.perplexity.ai/library'
    logger.info('Discovering threads via REST API...')

    await page.goto(perplexityLibraryUrl)
    await page.waitForLoadState('domcontentloaded')

    const activeApiVersion = await this.detectCurrentApiVersion(page)

    const discoveredConversations = await this.paginateAndFetchAllThreads(page, activeApiVersion)

    logger.success(`Discovered ${discoveredConversations.length} threads`)
    return discoveredConversations
  }

  private async detectCurrentApiVersion(page: Page): Promise<string> {
    const defaultFallbackVersion = '2.18'

    try {
      const interceptedRequest = await page.waitForRequest(
        (request) => request.url().includes('/rest/thread/list_ask_threads'),
        { timeout: 5000 }
      )

      const requestUrl = interceptedRequest.url()
      const versionQueryParameterMatch = requestUrl.match(/[?&]version=([^&]+)/)

      if (versionQueryParameterMatch?.[1]) {
        const detectedVersion = versionQueryParameterMatch[1]
        logger.info(`Discovered API version: ${detectedVersion}`)
        return detectedVersion
      }

      logger.warn('Found list_ask_threads request but no version parameter, using fallback')
      return defaultFallbackVersion
    } catch (_error) {
      logger.warn('No list_ask_threads request detected, using fallback version')
      return defaultFallbackVersion
    }
  }

  private async paginateAndFetchAllThreads(
    page: Page,
    apiVersion: string
  ): Promise<ConversationMetadata[]> {
    const batchPageSize = 20
    let currentOffset = 0
    const allDiscoveredConversations: ConversationMetadata[] = []

    while (true) {
      const threadBatch = await this.fetchThreadBatchFromApi(page, apiVersion, currentOffset, batchPageSize)

      if (!threadBatch.length) {
        logger.info(`No more threads found at offset ${currentOffset}`)
        break
      }

      const formattedMetadata = this.mapRawBatchToMetadata(threadBatch)
      allDiscoveredConversations.push(...formattedMetadata)

      logger.info(`Fetched ${threadBatch.length} threads (offset ${currentOffset})`)
      currentOffset += batchPageSize
    }

    return allDiscoveredConversations
  }

  private async fetchThreadBatchFromApi(
    page: Page,
    apiVersion: string,
    offset: number,
    limit: number
  ): Promise<any[]> {
    try {
      return await page.evaluate(
        async ({ offset, limit, version }) => {
          const response = await fetch(
            `/rest/thread/list_ask_threads?version=${version}&source=default`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ limit, ascending: false, offset, search_term: '' }),
            }
          )

          if (!response.ok) {
            throw new Error(`API responded with ${response.status}`)
          }

          const responseData = await response.json()
          return Array.isArray(responseData) ? responseData : []
        },
        { offset, limit, version: apiVersion }
      )
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      throw new LibraryDiscovery.PaginationError(
        `Failed to fetch batch at offset ${offset}: ${errorMessage}`
      )
    }
  }

  private mapRawBatchToMetadata(batch: any[]): ConversationMetadata[] {
    return batch
      .filter((item) => this.isMinimumRequiredThreadDataPresent(item))
      .map((item) => ({
        url: `https://www.perplexity.ai/search/${item.slug}`,
        title: item.title ?? 'Untitled',
        spaceName: item.collection?.title ?? 'General',
        timestamp: item.last_query_datetime ?? undefined,
      }))
  }

  private isMinimumRequiredThreadDataPresent(item: any): boolean {
    return !!(item && typeof item === 'object' && item.slug && typeof item.slug === 'string')
  }
}
