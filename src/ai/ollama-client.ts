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
  constructor(private readonly applicationConfig: Config) {}

  async embed(inputTextsToEmbed: string[]): Promise<number[][]> {
    const isInputEmpty = inputTextsToEmbed.length === 0
    if (isInputEmpty) return []

    const responseData = await this.performPostRequest('/v1/embeddings', {
      model: this.applicationConfig.ollamaEmbedModel,
      input: inputTextsToEmbed,
    })
    return this.parseEmbeddingsFromResponse(responseData)
  }

  async generate(promptText: string, modelNameOverride?: string): Promise<string> {
    const responseData = await this.performPostRequest('/api/generate', {
      model: modelNameOverride ?? this.applicationConfig.ollamaModel,
      prompt: promptText,
      stream: false,
    })
    const validatedGenerationData = generationResponseSchema.parse(responseData)
    return validatedGenerationData.response
  }

  async validate(): Promise<void> {
    logger.info('Validating Ollama configuration...')
    try {
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (validationError) {
      errorBus.raiseError(`Ollama validation failed`, validationError)
    }
  }

  private async performPostRequest(apiEndpoint: string, requestBody: object): Promise<unknown> {
    const fullRequestUrl = `${this.applicationConfig.ollamaUrl}${apiEndpoint}`
    try {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const isRequestSuccessful = httpResponse.ok
      if (!isRequestSuccessful) {
        let errorBodyText = ''
        try {
          errorBodyText = await httpResponse.text()
        } catch {
          // Ignore body reading errors
        }

        errorBus.raiseError(`Ollama request failed with status ${httpResponse.status}`, undefined, {
          body: requestBody,
          errorBody: errorBodyText.slice(0, 500),
        })
      }
      return await httpResponse.json()
    } catch (requestError) {
      const isOllamaSpecificError = requestError instanceof Error && requestError.message.includes('Ollama request failed')
      if (isOllamaSpecificError) {
        throw requestError
      }
      errorBus.raiseError(`Network error while calling Ollama`, requestError)
    }
  }

  private parseEmbeddingsFromResponse(responseData: unknown): number[][] {
    const openAiFormatResult = openAiFormatSchema.safeParse(responseData)
    if (openAiFormatResult.success) {
      return openAiFormatResult.data.data.map((item) => item.embedding)
    }

    const legacyFormatResult = legacyFormatSchema.safeParse(responseData)
    if (legacyFormatResult.success) {
      return [legacyFormatResult.data.embedding]
    }

    return errorBus.raiseError('Unexpected response format from Ollama embeddings endpoint')
  }
}
