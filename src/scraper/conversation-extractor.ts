import type { BrowserContext, Page } from 'patchright'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import {
  ApiExtractionStrategy,
  DomScrapeExtractionStrategy,
  NativeExportExtractionStrategy,
  AiScrapeExtractionStrategy,
  type ExtractionStrategy,
  type ExtractedConversation
} from './extraction-strategy.js'
import { handleCloudflare } from '../utils/cloudflare.js'

export { type ExtractedConversation }

export class ConversationExtractor {
  private strategies: ExtractionStrategy[]

  constructor(private context: BrowserContext) {
    const all = [
      new ApiExtractionStrategy(),
      new DomScrapeExtractionStrategy(),
      new NativeExportExtractionStrategy(),
      new AiScrapeExtractionStrategy()
    ]

    const primaryMode = config.extractionMode
    this.strategies = [
      all.find(s => s.constructor.name.toLowerCase().includes(primaryMode)) || all[0]!,
      ...all.filter(s => !s.constructor.name.toLowerCase().includes(primaryMode))
    ]
  }

  async extract(url: string): Promise<ExtractedConversation> {
    const page = await this.context.newPage()
    try {
      for (const strategy of this.strategies) {
        const strategyName = strategy.constructor.name
        try {
          logger.debug(`Attempting extraction with ${strategyName} for ${url}`)
          const result = await strategy.extract(page, url)

          const blocked = await handleCloudflare(page)
          if (blocked) {
            logger.warn(`Cloudflare block detected during ${strategyName}. Falling back...`)
            continue
          }

          if (result) return result
        } catch (e) {
          logger.warn(`${strategyName} failed for ${url}. Checking for Cloudflare...`)
          const blocked = await handleCloudflare(page)
          if (blocked) {
            logger.warn(`Confirmed Cloudflare block for ${strategyName}. Trying fallback...`)
            continue
          }
          logger.error(`Non-Cloudflare error in ${strategyName}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      throw new Error(`All extraction strategies failed for ${url}`)
    } finally {
      await page.close().catch(() => {})
    }
  }
}
