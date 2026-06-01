import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

const embeddingItemSchema = z.object({ embedding: z.array(z.number()) })
const openAiFormatSchema = z.object({ data: z.array(embeddingItemSchema) })
const legacyFormatSchema = z.object({ embedding: z.array(z.number()) })

const generationResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  response: z.string(),
  done: z.boolean(),
})

export class OllamaClient {
  constructor(private readonly config: Config) {}

  async embed(inputTexts: string[]): Promise<number[][]> {
    if (inputTexts.length === 0) return []
    const responseData = await this.post('/v1/embeddings', {
      model: this.config.ollamaEmbedModel,
      input: inputTexts,
    })
    return this.parseEmbeds(responseData)
  }

  async generate(promptText: string, modelOverride?: string): Promise<string> {
    const responseData = await this.post('/api/generate', {
      model: modelOverride ?? this.config.ollamaModel,
      prompt: promptText,
      stream: false,
    })
    return generationResponseSchema.parse(responseData).response
  }

  async validate(): Promise<void> {
    logger.info('Validating Ollama configuration...')
    try {
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (error) {
      throw new Error(`Ollama validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async post(endpoint: string, body: object): Promise<unknown> {
    const url = `${this.config.ollamaUrl}${endpoint}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        let errorBody = ''
        try { errorBody = await res.text() } catch {}
        errorBus.emitError(`Ollama HTTP ${res.status}`, undefined, {
          body,
          errorBody: errorBody.slice(0, 500),
        })
        throw new Error(`Ollama request failed with status ${res.status} – ${errorBody.slice(0, 200)}`)
      }
      return await res.json()
    } catch (e) {
      if (e instanceof Error && e.message.includes('Ollama request failed with status')) throw e
      throw new Error(`Network error while calling Ollama: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private parseEmbeds(data: unknown): number[][] {
    const openAi = openAiFormatSchema.safeParse(data)
    if (openAi.success) return openAi.data.data.map((item) => item.embedding)
    const legacy = legacyFormatSchema.safeParse(data)
    if (legacy.success) return [legacy.data.embedding]
    throw new Error('Unexpected response format from Ollama embeddings endpoint')
  }
}
