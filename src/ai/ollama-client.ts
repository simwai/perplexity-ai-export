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

const tagsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
  }))
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
    const requestBody = { model: config.ollamaEmbedModel, input: texts }
    const responseData = await this.performOllamaHttpRequest('/v1/embeddings', requestBody)
    return this.parseEmbeddingsFromResponse(responseData)
  }

  async generate(prompt: string, modelOverride?: string): Promise<string> {
    const requestBody = { model: modelOverride ?? config.ollamaModel, prompt, stream: false }
    const responseData = await this.performOllamaHttpRequest('/api/generate', requestBody)
    const validatedData = generationResponseSchema.parse(responseData)
    return validatedData.response
  }

  async generateWithVision(prompt: string, base64Image: string, modelOverride?: string): Promise<string> {
    const requestBody = {
      model: modelOverride ?? config.ollamaVisionModel,
      prompt,
      images: [base64Image],
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

  async ensureModelsAreReady(): Promise<void> {
    logger.info('Verifying required AI models...')
    try {
      const response = await this.performOllamaHttpRequest('/api/tags', {}, 'GET')
      const { models } = tagsResponseSchema.parse(response)
      const installedModels = models.map(m => m.name.split(':')[0])

      const required = [config.ollamaModel, config.ollamaVisionModel, config.ollamaEmbedModel]
      for (const model of required) {
        if (!installedModels.includes(model)) {
          logger.warn(`Model ${model} is missing. Triggering automatic pull...`)
          await this.pullModel(model)
        }
      }
      logger.success('All required models are ready.')
    } catch (e) {
      logger.warn(`Unable to verify models automatically: ${e instanceof Error ? e.message : String(e)}`)
      logger.info('Please ensure Ollama is running and models are installed.')
    }
  }

  private async pullModel(model: string): Promise<void> {
    logger.info(`Pulling ${model}... This may take a few minutes.`)
    await this.performOllamaHttpRequest('/api/pull', { name: model })
    logger.success(`Successfully pulled ${model}`)
  }

  private async performOllamaHttpRequest(endpoint: string, body: object, method: 'POST' | 'GET' = 'POST'): Promise<unknown> {
    const url = `${config.ollamaUrl}${endpoint}`
    try {
      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      }
      if (method === 'POST') options.body = JSON.stringify(body)

      const response = await fetch(url, options)
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new OllamaClient.OllamaError(`Ollama request failed with status ${response.status} – ${errorBody.slice(0, 100)}`)
      }
      return await response.json()
    } catch (_error) {
      if (_error instanceof OllamaClient.OllamaError) throw _error
      throw new OllamaClient.OllamaError(`Network error while calling Ollama: ${_error instanceof Error ? _error.message : String(_error)}`)
    }
  }

  private parseEmbeddingsFromResponse(data: unknown): number[][] {
    const openAiResult = openAiFormatSchema.safeParse(data)
    if (openAiResult.success) return openAiResult.data.data.map((item) => item.embedding)
    const legacyResult = legacyFormatSchema.safeParse(data)
    if (legacyResult.success) return [legacyResult.data.embedding]
    throw new OllamaClient.OllamaError('Unexpected response format from Ollama embeddings endpoint')
  }
}
