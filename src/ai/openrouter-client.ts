import { gotScraping } from 'got-scraping'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export class OpenRouterClient {
  private readonly baseUrl = 'https://openrouter.ai/api/v1'

  async generate(prompt: string, options: { model?: string; temperature?: number } = {}): Promise<string> {
    if (!config.openrouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured')
    }

    try {
      const response = await gotScraping.post(`${this.baseUrl}/chat/completions`, {
        headers: {
          'Authorization': `Bearer ${config.openrouterApiKey}`,
          'HTTP-Referer': 'https://github.com/simon/perplexity-history-export',
          'X-Title': 'Perplexity History Export',
        },
        json: {
          model: options.model ?? config.llmRagModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.7,
        },
        responseType: 'json',
      })

      const data: any = response.body
      return data.choices[0].message.content
    } catch (e) {
      logger.error('OpenRouter request failed:', e)
      throw new Error('Failed to generate text via OpenRouter')
    }
  }

  async generateWithVision(prompt: string, base64Image: string, options: { model?: string; temperature?: number } = {}): Promise<string> {
    if (!config.openrouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured')
    }

    try {
      const response = await gotScraping.post(`${this.baseUrl}/chat/completions`, {
        headers: {
          'Authorization': `Bearer ${config.openrouterApiKey}`,
          'HTTP-Referer': 'https://github.com/simon/perplexity-history-export',
          'X-Title': 'Perplexity History Export',
        },
        json: {
          model: options.model ?? config.llmVisionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
              ]
            }
          ],
          temperature: options.temperature ?? 0.7,
        },
        responseType: 'json',
      })

      const data: any = response.body
      return data.choices[0].message.content
    } catch (e) {
      logger.error('OpenRouter vision request failed:', e)
      throw new Error('Failed to generate vision response via OpenRouter')
    }
  }
}
