import type { Page, Response } from 'patchright'
import { logger } from '../utils/logger.js'
import { waitStrategy } from '../utils/wait-strategy.js'
import { z } from 'zod'
import { OllamaClient } from '../ai/ollama-client.js'
import { HumanNavigator } from '../utils/human-navigator.js'

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
  blocks: z.array(z.object({
    markdown_block: z.object({ answer: z.string().optional() }).optional(),
  })).optional(),
})

export class ApiExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    const apiDataPromise = this.captureConversationApiResponse(page)

    // Orgagnic navigation
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Add a bit of human activity to make the page load feel "real"
    if (Math.random() > 0.5) {
      await HumanNavigator.scrollNaturally(page, 200 + Math.random() * 300)
    }

    await waitStrategy.afterScroll(page)
    const apiData = await apiDataPromise
    return apiData ? this.parseConversationData(apiData, url) : null
  }

  private captureConversationApiResponse(page: Page): Promise<any> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 30000)
      page.on('response', async (response: Response) => {
        const url = response.url()
        if (url.includes('/rest/thread/') && !url.includes('list_ask_threads') && response.status() === 200) {
          try {
            const json = await response.json()
            clearTimeout(timeout)
            resolve(json)
          } catch { /* ignore */ }
        }
      })
    })
  }

  private parseConversationData(data: any, url: string): ExtractedConversation | null {
    const entries = Array.isArray(data) ? data : (data.entries || [data])
    const parseResult = z.array(EntrySchema).safeParse(entries)
    if (!parseResult.success) return null
    const validEntries = parseResult.data
    const firstEntry = validEntries[0]!
    return {
      id: url.match(/\/search\/([^/?]+)/)?.[1] ?? 'unknown',
      title: firstEntry.thread_title ?? data.thread_title ?? 'Untitled',
      spaceName: firstEntry.collection_info?.title ?? data.collection_info?.title ?? 'General',
      timestamp: new Date(firstEntry.updated_datetime ?? data.updated_datetime ?? Date.now()),
      content: this.convertToMarkdown(validEntries, firstEntry.thread_title ?? 'Conversation')
    }
  }

  private convertToMarkdown(entries: any[], title: string): string {
    return entries.map((entry, i) => {
      const question = entry.query_str || (i === 0 ? title : 'Follow-up')
      const answer = (entry.blocks || []).map((b: any) => b.markdown_block?.answer || '').join('\n\n')
      return `## ${question}\n\n${answer.trim()}`
    }).join('\n\n---\n\n')
  }
}

export class DomScrapeExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`Scraping DOM for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    // Human-like pause to "read" the content
    await page.waitForTimeout(1000 + Math.random() * 2000)
    await HumanNavigator.scrollNaturally(page, 500)

    return await page.evaluate((url) => {
      const title = document.querySelector('h1')?.innerText || 'Untitled'
      const content = Array.from(document.querySelectorAll('.prose')).map(p => (p as HTMLElement).innerText).join('\n\n')
      return {
        id: url.split('/').pop() || 'unknown',
        title,
        spaceName: 'General',
        timestamp: new Date(),
        content
      }
    }, url)
  }
}

export class NativeExportExtractionStrategy implements ExtractionStrategy {
  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`Executing Native Export strategy for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    try {
      await HumanNavigator.simulateBrowsing(page)

      const menuButton = page.locator('[data-testid="thread-actions-menu-button"]').or(page.locator('button:has-text("...")')).first()
      const box = await menuButton.boundingBox()
      if (box) {
          await HumanNavigator.moveMouseCurved(page, box.x + box.width / 2, box.y + box.height / 2)
          await page.waitForTimeout(300)
          await menuButton.click()
      } else {
          await menuButton.click()
      }

      await page.waitForTimeout(500)
      const exportButton = page.locator('text=Export').or(page.locator('text=Markdown').or(page.locator('text=Download'))).first()

      const [ download ] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        exportButton.click()
      ])

      await download.path()
      logger.success(`Native export download successful for ${url}`)

      return { id: url.split('/').pop()!, title: 'Native Export', spaceName: 'Export', timestamp: new Date(), content: 'Content exported to download directory' }
    } catch (e) {
      logger.warn(`Native interaction failed for ${url}: ${e}. Falling back...`)
      return null
    }
  }
}

export class AiScrapeExtractionStrategy implements ExtractionStrategy {
  private ollama = new OllamaClient()

  async extract(page: Page, url: string): Promise<ExtractedConversation | null> {
    logger.info(`Executing AI-Assisted DOM Scrape for ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await HumanNavigator.scrollNaturally(page, 400)

    const bodyHtml = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement
      clone.querySelectorAll('script, style, svg, path, iframe').forEach(e => e.remove())
      return clone.innerHTML.substring(0, 10000)
    })

    try {
      const prompt = `Extract the main CSS selectors for a Perplexity thread from this HTML.
      I need selectors for: 1. The thread title, 2. The question blocks, 3. The answer/prose blocks.
      Return JSON format: {"title": "...", "questions": "...", "answers": "..."}
      HTML Snippet: ${bodyHtml}`

      const response = await this.ollama.generate(prompt)
      const selectors = JSON.parse(response.match(/\{.*\}/s)?.[0] || '{}')

      if (selectors.title && selectors.answers) {
        return await page.evaluate(({ url, selectors }) => {
          const title = document.querySelector(selectors.title)?.innerText || 'Untitled'
          const content = Array.from(document.querySelectorAll(selectors.answers)).map(p => (p as HTMLElement).innerText).join('\n\n')
          return { id: url.split('/').pop()!, title, spaceName: 'AI Scrape', timestamp: new Date(), content }
        }, { url, selectors })
      }
    } catch (e) {
      logger.warn(`AI selector extraction failed: ${e}. Using default DOM scraper.`)
    }

    return new DomScrapeExtractionStrategy().extract(page, url)
  }
}
