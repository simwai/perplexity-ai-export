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
          temperature: options.temperature ?? 0.2,
        },
        responseType: 'json',
      })

      const data: any = response.body
      if (!data?.choices?.[0]?.message?.content) {
        throw new Error(`Invalid response structure from OpenRouter: ${JSON.stringify(data)}`)
      }
      return data.choices[0].message.content
    } catch (e) {
      logger.error('OpenRouter request failed:', e)
      throw new Error(`Failed to generate text via OpenRouter: ${e instanceof Error ? e.message : String(e)}`)
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
          temperature: options.temperature ?? 0.1,
        },
        responseType: 'json',
      })

      const data: any = response.body
      if (!data?.choices?.[0]?.message?.content) {
        throw new Error(`Invalid vision response structure from OpenRouter: ${JSON.stringify(data)}`)
      }
      return data.choices[0].message.content
    } catch (e) {
      logger.error('OpenRouter vision request failed:', e)
      throw new Error(`Failed to generate vision response via OpenRouter: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
