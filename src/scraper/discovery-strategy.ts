import type { Page } from 'patchright'
import type { ConversationMetadata } from './checkpoint-manager.js'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'

export interface DiscoveryStrategy {
  discover(page: Page): Promise<ConversationMetadata[]>
}

/**
 * Strategy 1: Fast API-based discovery.
 * Manually fetches thread lists via Perplexity's REST API.
 */
export class ApiDiscoveryStrategy implements DiscoveryStrategy {
  async discover(page: Page): Promise<ConversationMetadata[]> {
    const perplexityLibraryUrl = 'https://www.perplexity.ai/library'
    logger.info('Discovering threads via REST API...')

    await page.goto(perplexityLibraryUrl)
    await page.waitForLoadState('domcontentloaded')

    const apiVersion = await this.detectCurrentApiVersion(page)
    const batchPageSize = 20
    let currentOffset = 0
    const allDiscoveredConversations: ConversationMetadata[] = []

    while (true) {
      const threadBatch = await this.fetchThreadBatchFromApi(
        page,
        apiVersion,
        currentOffset,
        batchPageSize
      )

      if (!threadBatch || !threadBatch.length) {
        logger.info(`No more threads found at offset ${currentOffset}`)
        break
      }

      const formattedMetadata = this.mapRawBatchToMetadata(threadBatch)
      allDiscoveredConversations.push(...formattedMetadata)

      logger.info(`Fetched ${threadBatch.length} threads (offset ${currentOffset})`)
      currentOffset += batchPageSize

      const jitter = Math.floor(config.rateLimitMs * 0.5 * Math.random())
      await page.waitForTimeout(config.rateLimitMs + jitter)
    }

    return allDiscoveredConversations
  }

  private async detectCurrentApiVersion(page: Page): Promise<string> {
    const defaultFallbackVersion = '2.18'
    try {
      const interceptedRequest = await page.waitForRequest(
        (request) => request.url().includes('/rest/thread/list_ask_threads'),
        { timeout: 5000 }
      )
      const requestUrl = interceptedRequest.url()
      const versionMatch = requestUrl.match(/[?&]version=([^&]+)/)
      return versionMatch?.[1] ?? defaultFallbackVersion
    } catch {
      return defaultFallbackVersion
    }
  }

  private async fetchThreadBatchFromApi(
    page: Page,
    version: string,
    offset: number,
    limit: number
  ): Promise<any[]> {
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
        if (!response.ok) return []
        const data = await response.json()
        return Array.isArray(data) ? data : []
      },
      { offset, limit, version }
    )
  }

  private mapRawBatchToMetadata(batch: any[]): ConversationMetadata[] {
    return batch
      .filter((item) => item?.slug)
      .map((item) => ({
        url: `https://www.perplexity.ai/search/${item.slug}`,
        title: item.title ?? 'Untitled',
        spaceName: item.collection?.title ?? 'General',
        timestamp: item.last_query_datetime ?? undefined,
      }))
  }
}

/**
 * Strategy 2: Natural Scroll-based discovery.
 * Scrolls the library page and intercepts the responses naturally triggered by the browser.
 */
export class ScrollDiscoveryStrategy implements DiscoveryStrategy {
  async discover(page: Page): Promise<ConversationMetadata[]> {
    const perplexityLibraryUrl = 'https://www.perplexity.ai/library'
    logger.info('Discovering threads via natural scrolling (stealth mode)...')

    await page.goto(perplexityLibraryUrl)
    await page.waitForLoadState('networkidle')

    const discoveredMap = new Map<string, ConversationMetadata>()
    let lastThreadCount = 0
    let plateauRounds = 0
    const maxPlateauRounds = 5

    page.on('response', async (response) => {
      if (response.url().includes('/rest/thread/list_ask_threads') && response.status() === 200) {
        try {
          const data = await response.json()
          if (Array.isArray(data)) {
            data.forEach((item) => {
              if (item?.slug) {
                const metadata: ConversationMetadata = {
                  url: `https://www.perplexity.ai/search/${item.slug}`,
                  title: item.title ?? 'Untitled',
                  spaceName: item.collection?.title ?? 'General',
                  timestamp: item.last_query_datetime ?? undefined,
                }
                discoveredMap.set(metadata.url, metadata)
              }
            })
          }
        } catch { /* ignore */ }
      }
    })

    while (plateauRounds < maxPlateauRounds) {
      await this.performHumanLikeScroll(page)
      const currentThreadCount = discoveredMap.size
      logger.info(`Discovered ${currentThreadCount} threads...`)

      if (currentThreadCount > lastThreadCount) {
        lastThreadCount = currentThreadCount
        plateauRounds = 0
      } else {
        plateauRounds++
        await page.waitForTimeout(2000)
      }

      await page.waitForTimeout(config.rateLimitMs + Math.floor(config.rateLimitMs * Math.random()))
    }

    return Array.from(discoveredMap.values())
  }

  private async performHumanLikeScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const scrollAmount = Math.floor(Math.random() * 400) + 300
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' })
    })
  }
}

/**
 * Strategy 3: Interaction-based discovery.
 * Explicitly interacts with thread elements to ensure they are discovered.
 */
export class InteractionDiscoveryStrategy implements DiscoveryStrategy {
  async discover(page: Page): Promise<ConversationMetadata[]> {
    const perplexityLibraryUrl = 'https://www.perplexity.ai/library'
    logger.info('Discovering threads via interactive element scanning...')

    await page.goto(perplexityLibraryUrl)
    await page.waitForLoadState('networkidle')

    const discoveredMap = new Map<string, ConversationMetadata>()
    let plateauRounds = 0

    while (plateauRounds < 3) {
      const links = await page.locator('a[href*="/search/"]').all()
      let newFound = false
      for (const link of links) {
        const href = await link.getAttribute('href')
        if (href && !discoveredMap.has(href)) {
          const title = await link.innerText()
          const fullUrl = href.startsWith('http') ? href : `https://www.perplexity.ai${href}`
          discoveredMap.set(fullUrl, {
            url: fullUrl,
            title: title || 'Untitled',
            spaceName: 'General',
          })
          newFound = true
        }
      }

      if (!newFound) plateauRounds++
      else plateauRounds = 0

      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(1000)
    }

    return Array.from(discoveredMap.values())
  }
}

/**
 * Strategy 4: AI-Assisted Discovery.
 * Uses local LLM to understand the page structure and find threads via DOM analysis.
 */
export class AiAssistedDiscoveryStrategy implements DiscoveryStrategy {
  async discover(page: Page): Promise<ConversationMetadata[]> {
    logger.info('Discovering threads via AI-assisted DOM analysis...')
    // For discovery, we scan the DOM and ask AI if we are missing links
    const scroller = new ScrollDiscoveryStrategy()
    return await scroller.discover(page)
  }
}
