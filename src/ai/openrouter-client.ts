import { gotScraping } from 'got-scraping'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { OpenRouterError } from '../utils/errors.js'

export class OpenRouterClient {
  private readonly baseUrl = 'https://openrouter.ai/api/v1'

  async generate(prompt: string, options: { model?: string; temperature?: number } = {}): Promise<string> {
    if (!config.openrouterApiKey) {
      throw new OpenRouterError('OPENROUTER_API_KEY is not configured')
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
        timeout: { request: 60000 },
        // Use standard headers for cloud API to avoid bot-detection interference
        context: { useHeaderGenerator: false },
        http2: false
      })

      const data: any = response.body
      if (data?.error) throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`)
      if (!data?.choices?.[0]?.message?.content) throw new Error(`Unexpected response structure: ${JSON.stringify(data)}`)

      return data.choices[0].message.content
    } catch (e) {
      logger.error('OpenRouter text generation failed:', e)
      throw new OpenRouterError(`Failed to generate text via OpenRouter: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async generateWithVision(prompt: string, base64Image: string, options: { model?: string; temperature?: number } = {}): Promise<string> {
    if (!config.openrouterApiKey) {
      throw new OpenRouterError('OPENROUTER_API_KEY is not configured')
    }

    // Attempt 1: Standard OpenAI-compatible vision format
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
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          temperature: options.temperature ?? 0.1,
        },
        responseType: 'json',
        timeout: { request: 120000 },
        context: { useHeaderGenerator: false },
        http2: false
      })

      const data: any = response.body
      if (data?.error) throw new Error(data.error.message || 'API Error')
      if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content

      throw new Error('No content in choices')
    } catch (e) {
      logger.warn(`Primary vision request failed: ${e instanceof Error ? e.message : String(e)}. Retrying with inline fallback...`)

      // Attempt 2: Text-only model fallback (inline base64)
      const inlinePrompt = `${prompt}\n\n[IMAGE_DATA_BASE64_JPEG]:\ndata:image/jpeg;base64,${base64Image}`

      try {
        const response = await gotScraping.post(`${this.baseUrl}/chat/completions`, {
          headers: {
            'Authorization': `Bearer ${config.openrouterApiKey}`,
          },
          json: {
            model: options.model ?? config.llmVisionModel,
            messages: [{ role: 'user', content: inlinePrompt }],
            temperature: options.temperature ?? 0.1,
          },
          responseType: 'json',
          timeout: { request: 120000 },
          context: { useHeaderGenerator: false },
          http2: false
        })

        const data: any = response.body
        if (data?.error) throw new Error(data.error.message || 'API Error')
        if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content

        throw new Error('All OpenRouter vision methods failed to return content.')
      } catch (innerError) {
        logger.error('OpenRouter vision fallback failed:', innerError)
        throw new OpenRouterError(`Vision analysis failed: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`)
      }
    }
  }
}
