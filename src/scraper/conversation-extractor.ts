import type { BrowserContext } from 'patchright'
import { config } from '../utils/config.js'
import {
  ApiExtractionStrategy,
  DomScrapeExtractionStrategy,
  NativeExportExtractionStrategy,
  AiScrapeExtractionStrategy,
  type ExtractionStrategy,
  type ExtractedConversation
} from './extraction-strategy.js'

export { type ExtractedConversation }

export class ConversationExtractor {
  private strategy: ExtractionStrategy

  constructor(private context: BrowserContext) {
    switch (config.extractionMode) {
      case 'dom': this.strategy = new DomScrapeExtractionStrategy(); break
      case 'native': this.strategy = new NativeExportExtractionStrategy(); break
      case 'ai': this.strategy = new AiScrapeExtractionStrategy(); break
      default: this.strategy = new ApiExtractionStrategy()
    }
  }

  async extract(url: string): Promise<ExtractedConversation> {
    const page = await this.context.newPage()
    try {
      const result = await this.strategy.extract(page, url)
      if (!result) throw new Error('Extraction failed')
      return result
    } finally {
      await page.close().catch(() => {})
    }
  }
}
