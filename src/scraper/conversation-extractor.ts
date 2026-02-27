import type { BrowserContext, Response } from '@playwright/test'
import { waitStrategy } from '../utils/wait-strategy.js'
import { logger } from '../utils/logger.js'

export interface ExtractedConversation {
  id: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
}

export class ConversationExtractor {
  private readonly context: BrowserContext

  constructor(context: BrowserContext) {
    this.context = context
  }

  async extract(url: string): Promise<ExtractedConversation | null> {
    const page = await this.context.newPage()
    let conversationData: any = null

    page.on('response', async (response: Response) => {
      const responseUrl = response.url()
      if (!responseUrl.includes('/rest/thread/') || responseUrl.includes('list_ask_threads')) return

      try {
        const json = await response.json()
        if (json.entries) {
          conversationData = json
        }
      } catch {
        // Ignore non-JSON responses
      }
    })

    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })

      // Check HTTP status
      if (!response) {
        throw new Error('Navigation failed - no response received')
      }

      const status = response.status()
      if (status === 404) {
        throw new Error('Conversation not found (404)')
      }
      if (status === 403 || status === 401) {
        throw new Error('Authentication required or expired (403/401)')
      }
      if (status >= 500) {
        throw new Error(`Server error (${status})`)
      }
      if (status >= 400) {
        throw new Error(`HTTP error ${status}`)
      }

      await waitStrategy.afterScroll(page)

      if (!conversationData) {
        throw new Error('No API response intercepted - conversation data not captured')
      }

      const parsed = this.parseConversationData(conversationData, url)
      if (!parsed) {
        throw new Error('Failed to parse conversation data')
      }

      return parsed
    } catch (error) {
      // ✅ Preserve and re-throw error details
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Extraction failed: ${message}`)
    } finally {
      await page.close()
    }
  }

  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    const entries = this.normalizeEntries(data)

    if (!entries.length) {
      logger.warn(`Thread has no entries: ${url}`)
      return null
    }

    const firstEntry = entries[0]

    const id = this.extractIdFromUrl(url)
    const title = firstEntry.thread_title ?? data.thread_title ?? 'Untitled'

    const spaceName = firstEntry.collection_info?.title ?? data.collection_info?.title ?? 'General'

    const timestamp = firstEntry.updated_datetime
      ? new Date(firstEntry.updated_datetime)
      : data.updated_datetime
        ? new Date(data.updated_datetime)
        : new Date()

    const content = this.formatEntries(entries)

    if (!content) {
      logger.warn(`Thread has empty content after formatting: ${url}`)
      return null
    }

    return { id, title, spaceName, timestamp, content }
  }

  private normalizeEntries(data: any): any[] {
    if (Array.isArray(data.entries) && data.entries.length > 0) {
      return data.entries
    }

    if (data && (data.query_str || data.blocks)) {
      return [data]
    }

    return []
  }

  private extractIdFromUrl(url: string): string {
    const match = url.match(/\/search\/([^/?]+)/)
    return match?.[1] ?? 'unknown'
  }

  private formatEntries(entries: any[]): string {
    let markdown = ''

    for (const entry of entries) {
      const question = entry.query_str ?? ''

      // Fix: Accumulate ALL answer blocks, do not stop at the first one
      let fullAnswer = ''
      for (const block of entry.blocks ?? []) {
        if (block.markdown_block?.answer) {
          fullAnswer += block.markdown_block.answer + '\n\n'
        }
      }

      if (question) {
        markdown += `## ${question}\n\n`
      }
      if (fullAnswer) {
        markdown += `${fullAnswer.trim()}\n\n`
      }
      markdown += '---\n\n'
    }

    return markdown.trim()
  }
}
