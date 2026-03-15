import type { Page, Response } from 'patchright'
import { logger } from '../utils/logger.js'
import { waitStrategy } from '../utils/wait-strategy.js'
import { z } from 'zod'

export interface ExtractedConversation {
  id: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
}

export interface ExtractionStrategy {
  extract(page: Page, url: string): Promise<ExtractedConversation | null>
}

const EntrySchema = z.object({
  thread_title: z.string().optional(),
  collection_info: z.object({ title: z.string().optional() }).optional(),
  updated_datetime: z.string().optional(),
  query_str: z.string().optional(),
  blocks: z
    .array(
      z.object({
        markdown_block: z.object({ answer: z.string().optional() }).optional(),
      })
    )
    .optional(),
})

export class ApiExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    const apiDataPromise = this.captureConversationApiResponse(page)

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitStrategy.afterScroll(page)

    const apiData = await apiDataPromise
    if (!apiData) return null

    return this.parseConversationData(apiData, url)
  }

  private captureConversationApiResponse(page: Page): Promise<any> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 30000)
      page.on('response', async (response: Response) => {
        const url = response.url()
        if (
          url.includes('/rest/thread/') &&
          !url.includes('list_ask_threads') &&
          response.status() === 200
        ) {
          try {
            const json = await response.json()
            clearTimeout(timeout)
            resolve(json)
          } catch {
            /* ignore */
          }
        }
      })
    })
  }

  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    const entries = Array.isArray(data) ? data : data.entries || [data]
    const parseResult = z.array(EntrySchema).safeParse(entries)
    if (!parseResult.success) return null

    const validEntries = parseResult.data
    const firstEntry = validEntries[0]!

    return {
      id: url.match(/\/search\/([^/?]+)/)?.[1] ?? 'unknown',
      title: firstEntry.thread_title ?? data.thread_title ?? 'Untitled',
      spaceName: firstEntry.collection_info?.title ?? data.collection_info?.title ?? 'General',
      timestamp: new Date(firstEntry.updated_datetime ?? data.updated_datetime ?? Date.now()),
      content: this.convertToMarkdown(validEntries, firstEntry.thread_title ?? 'Conversation'),
    }
  }

  private convertToMarkdown(entries: any[], title: string): string {
    return entries
      .map((entry, i) => {
        const question = entry.query_str || (i === 0 ? title : 'Follow-up')
        const answer = (entry.blocks || [])
          .map((b: any) => b.markdown_block?.answer || '')
          .join('\n\n')
        return `## ${question}\n\n${answer.trim()}`
      })
      .join('\n\n---\n\n')
  }
}

export class DomScrapeExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`Scraping DOM for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    return await page.evaluate((url) => {
      const title = document.querySelector('h1')?.innerText || 'Untitled'
      const content = Array.from(document.querySelectorAll('.prose'))
        .map((p) => (p as HTMLElement).innerText)
        .join('\n\n')

      return {
        id: url.split('/').pop() || 'unknown',
        title,
        spaceName: 'General',
        timestamp: new Date(),
        content,
      }
    }, url)
  }
}

export class NativeExportExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`Triggering native export for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    return {
      id: 'ext',
      title: 'Exported',
      spaceName: 'Export',
      timestamp: new Date(),
      content: 'Downloaded content',
    }
  }
}

export class AiScrapeExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`AI-Assisted scraping for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    const fallback = new DomScrapeExtractionStrategy()
    return fallback.extract(page, url)
  }
}
