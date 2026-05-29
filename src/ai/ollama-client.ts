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
  static readonly OllamaError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaError'
    }
  }

  constructor(private readonly config: Config) {}

  async embed(inputTexts: string[]): Promise<number[][]> {
    const isInputEmpty = inputTexts.length === 0
    if (isInputEmpty) return []

    const requestBody = {
      model: this.config.ollamaEmbedModel,
      input: inputTexts,
    }

    const responseData = await this.performOllamaHttpRequest('/v1/embeddings', requestBody)
    return this.parseEmbeddingsFromResponse(responseData)
  }

  async generate(promptText: string, modelOverride?: string): Promise<string> {
    const requestBody = {
      model: modelOverride ?? this.config.ollamaModel,
      prompt: promptText,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new OllamaClient.OllamaError(`Ollama validation failed: ${errorMessage}`)
    }
  }

  private async performOllamaHttpRequest(
    apiEndpoint: string,
    requestBody: object
  ): Promise<unknown> {
    const fullRequestUrl = `${this.config.ollamaUrl}${apiEndpoint}`

    try {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const isResponseSuccessful = httpResponse.ok
      if (!isResponseSuccessful) {
        let rawErrorBody = ''
        try {
          rawErrorBody = await httpResponse.text()
        } catch (_ignored) {
          // Fallback to empty string if body reading fails
        }

        errorBus.emitError(`Ollama HTTP ${httpResponse.status}`, undefined, {
          body: requestBody,
          errorBody: rawErrorBody.slice(0, 500),
        })

        const errorExcerpt = rawErrorBody.slice(0, 200)
        throw new OllamaClient.OllamaError(
          `Ollama request failed with status ${httpResponse.status} – ${errorExcerpt}`
        )
      }

      return await httpResponse.json()
    } catch (error) {
      const isOllamaError = error instanceof OllamaClient.OllamaError
      if (isOllamaError) throw error

      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new OllamaClient.OllamaError(`Network error while calling Ollama: ${errorMessage}`)
    }
  }

  private parseEmbeddingsFromResponse(responseData: unknown): number[][] {
    const openAiParseResult = openAiFormatSchema.safeParse(responseData)
    if (openAiParseResult.success) {
      return openAiParseResult.data.data.map((item) => item.embedding)
    }

    const legacyParseResult = legacyFormatSchema.safeParse(responseData)
    if (legacyParseResult.success) {
      return [legacyParseResult.data.embedding]
    }

    throw new OllamaClient.OllamaError('Unexpected response format from Ollama embeddings endpoint')
  }
}
