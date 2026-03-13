import type { Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import type { ConversationMetadata } from './checkpoint-manager.js'

const unexpectedUrlFormatError = new Error('Unexptected URL format')

export class LibraryDiscovery {
  async discoverFromLibrary(page: Page): Promise<ConversationMetadata[]> {
    logger.info('Discovering threads via REST API...')

    await page.goto('https://www.perplexity.ai/library')
    await page.waitForLoadState('domcontentloaded')

    // 1. Capture API version from a real request (fallback 2.18)
    const apiVersion = await this.captureApiVersionFromRequest(page)

    // 2. Paginate until no more threads
    const conversations: ConversationMetadata[] = await this.paginateUntilEnd(page, apiVersion)

    logger.success(`Discovered ${conversations.length} threads`)
    return conversations
  }

  private async paginateUntilEnd(page: Page, apiVersion: string) {
    const pageSize = 20
    let offset = 0
    const conversations: ConversationMetadata[] = []

    while (true) {
      const batch = await page.evaluate(
        async ({ offset, limit, version }) => {
          const res = await fetch(
            `/rest/thread/list_ask_threads?version=${version}&source=default`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ limit, ascending: false, offset, search_term: '' })
            }
          )
          if (!res.ok) return []
          const data = await res.json()
          return Array.isArray(data) ? data : []
        },
        { offset, limit: pageSize, version: apiVersion }
      )

      if (!batch.length) break

      for (const item of batch) {
        conversations.push({
          url: `https://www.perplexity.ai/search/${item.slug}`,
          title: item.title ?? 'Untitled',
          spaceName: item.collection?.title ?? 'General',
          timestamp: item.last_query_datetime ?? undefined,
        })
      }

      logger.info(`Fetched ${batch.length} threads (offset ${offset})`)
      offset += pageSize
    }
    return conversations
  }

  private async captureApiVersionFromRequest(page: Page) {
    let apiVersion = '2.18'

    const request = await page.waitForRequest(
      (req) => req.url().includes('/rest/thread/list_ask_threads'),
      { timeout: 5000 }
    ).catch(() => null)

    if (request) {
      const match = request.url().match(/[?&]version=([^&]+)/)
      if (!match?.[1]) throw unexpectedUrlFormatError

      if (match) apiVersion = match[1]
      logger.info(`Using API version: ${apiVersion}`)
    }
    return apiVersion
  }
}
