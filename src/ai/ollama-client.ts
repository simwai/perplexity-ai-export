import { z } from 'zod'
import { gotScraping } from 'got-scraping'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { execSync } from 'node:child_process'

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
  models: z.array(
    z.object({
      name: z.string(),
    })
  ),
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

  async generate(
    prompt: string,
    options: { model?: string; temperature?: number } = {}
  ): Promise<string> {
    const requestBody = {
      model: options.model ?? config.ollamaModel,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.2,
      },
    }
    const responseData = await this.performOllamaHttpRequest('/api/generate', requestBody)
    const validatedData = generationResponseSchema.parse(responseData)
    return validatedData.response
  }

  async generateWithVision(
    prompt: string,
    base64Image: string,
    options: { model?: string; temperature?: number } = {}
  ): Promise<string> {
    const requestBody = {
      model: options.model ?? config.ollamaVisionModel,
      prompt,
      images: [base64Image],
      stream: false,
      options: {
        temperature: options.temperature ?? 0.2,
      },
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

      // Ollama model names can be 'model:latest', 'model:tag', or just 'model'
      const installedModels = models.map((m) => m.name)
      const installedBaseNames = models.map((m) => m.name.split(':')[0])

      const required = [config.ollamaModel, config.ollamaVisionModel, config.ollamaEmbedModel]
      for (const model of required) {
        const isInstalled =
          installedModels.includes(model) ||
          installedModels.includes(`${model}:latest`) ||
          installedBaseNames.includes(model)

        if (!isInstalled) {
          logger.warn(
            `Model ${model} is missing. Triggering "ollama pull" for maximum reliability...`
          )
          this.pullModel(model)
        }
      }
      logger.success('All required models are verified.')
    } catch (e) {
      logger.warn(
        `Automated model verification via API failed: ${e instanceof Error ? e.message : String(e)}`
      )
      logger.info(
        'Falling back to manual check. If the models are missing, the system will error later.'
      )
    }
  }

  private pullModel(model: string): void {
    logger.info(`Pulling ${model}... This will show progress in your terminal.`)
    try {
      // Use the system command to pull models as requested for better robustness and UX
      execSync(`ollama pull ${model}`, { stdio: 'inherit' })
      logger.success(`Successfully installed ${model}`)
    } catch (e) {
      logger.error(`Failed to pull model ${model} via command line.`)
      throw new OllamaClient.OllamaError(`Please run "ollama pull ${model}" manually.`)
    }
  }

  private async performOllamaHttpRequest(
    endpoint: string,
    body: object,
    method: 'POST' | 'GET' = 'POST'
  ): Promise<unknown> {
    const url = `${config.ollamaUrl}${endpoint}`

    try {
      const response = await gotScraping({
        url,
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { json: body } : {}),
        responseType: 'json',
      })

      const status = response.statusCode
      if (status < 200 || status >= 300) {
        const errorBody =
          typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? '')
        throw new OllamaClient.OllamaError(
          `Ollama request failed with status ${status} – ${errorBody.slice(0, 100)}`
        )
      }

      return response.body
    } catch (_error) {
      // Log raw error for debugging
      logger.error('Ollama HTTP error', _error)

      if (_error instanceof OllamaClient.OllamaError) throw _error

      const msg =
        _error instanceof Error ? `${_error.name}: ${_error.message}` : JSON.stringify(_error)

      throw new OllamaClient.OllamaError(`Network error while calling Ollama: ${msg}`)
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
