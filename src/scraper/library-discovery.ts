import type { Page } from '@playwright/test'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'
import type { ConversationMetadata } from './checkpoint-manager.js'

type ThreadListItem = {
  slug: string
  title: string
  last_query_datetime: string
  collection?: { title?: string | null }
}

export class LibraryDiscovery {
  async discoverFromLibrary(page: Page): Promise<ConversationMetadata[]> {
    logger.info('Starting Library discovery via rest/thread/list_ask_threads...')

    await page.goto('https://www.perplexity.ai/library')
    await page.waitForLoadState('domcontentloaded')

    const pageSize = 20
    let offset = 0
    const conversations: ConversationMetadata[] = []
    const maxThreads = 5000

    while (offset < maxThreads) {
      const batch: ThreadListItem[] = await page.evaluate(
        async ({ offset, limit }) => {
          const response = await fetch(
            '/rest/thread/list_ask_threads?version=2.18&source=default',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                limit,
                ascending: false,
                offset,
                search_term: '',
              }),
            }
          )

          if (!response.ok) {
            return []
          }

          const data = await response.json()
          if (!Array.isArray(data)) {
            return []
          }

          return data as ThreadListItem[]
        },
        { offset, limit: pageSize }
      )

      if (!batch.length) {
        logger.info(`No more threads from list_ask_threads at offset ${offset}`)
        break
      }

      for (const item of batch) {
        const url = `https://www.perplexity.ai/search/${item.slug}`

        conversations.push({
          url,
          title: item.title ?? 'Untitled',
          spaceName: item.collection?.title ?? 'General',
          timestamp: item.last_query_datetime ?? undefined,
        })
      }

      logger.info(`Fetched ${batch.length} threads (offset ${offset})`)
      offset += pageSize
      await waitStrategy.afterScroll(page)
    }

    logger.success(`Discovered ${conversations.length} threads from REST API`)
    return conversations
  }
}
