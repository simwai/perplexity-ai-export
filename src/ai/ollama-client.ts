import { z } from 'zod'
import { config } from '../utils/config.js'
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
  static readonly OllamaError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaError'
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const requestBody = {
      model: config.ollamaEmbedModel,
      input: texts,
    }

    const responseData = await this.performOllamaHttpRequest('/v1/embeddings', requestBody)
    return this.parseEmbeddingsFromResponse(responseData)
  }

  async generate(prompt: string, modelOverride?: string): Promise<string> {
    const requestBody = {
      model: modelOverride ?? config.ollamaModel,
      prompt,
      stream: false,
    }

    const responseData = await this.performOllamaHttpRequest('/api/generate', requestBody)
    const validatedData = generationResponseSchema.parse(responseData)
    return validatedData.response
  }

  async validate(): Promise<void> {
    logger.info('Validating Ollama configuration...')
    try {
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (_error) {
      const message = _error instanceof Error ? _error.message : String(_error)
      throw new OllamaClient.OllamaError(`Ollama validation failed: ${message}`)
    }
  }

  private async performOllamaHttpRequest(endpoint: string, body: object): Promise<unknown> {
    const url = `${config.ollamaUrl}${endpoint}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        let errorBody = ''
        try {
          errorBody = await response.text()
        } catch (_errorReadingResponseBody) {
          /* oxlint-disable-next-line no-empty */
        }
        logger.error(`Ollama HTTP ${response.status}`, { body, errorBody: errorBody.slice(0, 500) })
        throw new OllamaClient.OllamaError(
          `Ollama request failed with status ${response.status} – ${errorBody.slice(0, 200)}`
        )
      }

      return await response.json()
    } catch (_error) {
      if (_error instanceof OllamaClient.OllamaError) throw _error
      throw new OllamaClient.OllamaError(
        `Network error while calling Ollama: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private parseEmbeddingsFromResponse(data: unknown): number[][] {
    const openAiResult = openAiFormatSchema.safeParse(data)
    if (openAiResult.success) {
      return openAiResult.data.data.map((item) => item.embedding)
    }

    const legacyResult = legacyFormatSchema.safeParse(data)
    if (legacyResult.success) {
      return [legacyResult.data.embedding]
    }

    throw new OllamaClient.OllamaError('Unexpected response format from Ollama embeddings endpoint')
  }
}
