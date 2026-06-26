import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

const embeddingItemSchema = z.object({ embedding: z.array(z.number()) })
const openAiEmbedFormatSchema = z.object({ data: z.array(embeddingItemSchema) })
const legacyEmbedFormatSchema = z.object({ embedding: z.array(z.number()) })

const generationResponseSchema = z.object({
  model: z.string().optional(),
  created_at: z.string().optional(),
  response: z.string().optional(),
  message: z
    .object({
      role: z.string(),
      content: z.string(),
    })
    .optional(),
  choices: z.array(z.object({
    message: z.object({
      role: z.string(),
      content: z.string()
    }),
    finish_reason: z.string().optional()
  })).optional(),
  done: z.boolean().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number()
  }).optional()
})

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResponse {
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export class AiClient {
  static readonly AiError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AiError'
    }
  }

  constructor(private readonly config: Config) {}

  async embed(inputTexts: string[]): Promise<number[][]> {
    const isInputEmpty = inputTexts.length === 0
    if (isInputEmpty) return []

    const isOllama = this.config.aiEmbedProvider === 'ollama'
    const endpoint = isOllama ? '/v1/embeddings' : '/v1/embeddings'
    const baseUrl = isOllama ? this.config.ollamaUrl : this.config.aiBaseUrl

    const requestBody = {
      model: this.config.aiEmbedModel,
      input: inputTexts,
    }

    const responseData = await this.performHttpRequest(baseUrl, endpoint, requestBody)
    return this.parseEmbeddingsFromResponse(responseData)
  }

  async generate(promptText: string, modelOverride?: string): Promise<string> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel

    if (isOllama) {
      const requestBody = {
        model,
        prompt: promptText,
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.ollamaUrl, '/api/generate', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)
      return validatedData.response || ''
    } else {
      const requestBody = {
        model,
        messages: [{ role: 'user', content: promptText }],
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.aiBaseUrl, '/v1/chat/completions', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)
      return validatedData.choices?.[0]?.message.content || ''
    }
  }

  async generateWithUsage(promptText: string, modelOverride?: string): Promise<LlmResponse> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel

    if (isOllama) {
      const requestBody = {
        model,
        prompt: promptText,
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.ollamaUrl, '/api/generate', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)

      return {
        content: validatedData.response || '',
        usage: {
          promptTokens: validatedData.prompt_eval_count || 0,
          completionTokens: validatedData.eval_count || 0,
          totalTokens: (validatedData.prompt_eval_count || 0) + (validatedData.eval_count || 0),
        },
      }
    } else {
      const requestBody = {
        model,
        messages: [{ role: 'user', content: promptText }],
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.aiBaseUrl, '/v1/chat/completions', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)

      return {
        content: validatedData.choices?.[0]?.message.content || '',
        usage: {
          promptTokens: validatedData.usage?.prompt_tokens || 0,
          completionTokens: validatedData.usage?.completion_tokens || 0,
          totalTokens: validatedData.usage?.total_tokens || 0,
        },
      }
    }
  }

  async chat(messages: ChatMessage[], modelOverride?: string): Promise<LlmResponse> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel

    if (isOllama) {
      const requestBody = {
        model,
        messages,
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.ollamaUrl, '/api/chat', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)

      return {
        content: validatedData.message?.content || '',
        usage: {
          promptTokens: validatedData.prompt_eval_count || 0,
          completionTokens: validatedData.eval_count || 0,
          totalTokens: (validatedData.prompt_eval_count || 0) + (validatedData.eval_count || 0),
        },
      }
    } else {
      const requestBody = {
        model,
        messages,
        stream: false,
      }
      const responseData = await this.performHttpRequest(this.config.aiBaseUrl, '/v1/chat/completions', requestBody)
      const validatedData = generationResponseSchema.parse(responseData)

      return {
        content: validatedData.choices?.[0]?.message.content || '',
        usage: {
          promptTokens: validatedData.usage?.prompt_tokens || 0,
          completionTokens: validatedData.usage?.completion_tokens || 0,
          totalTokens: validatedData.usage?.total_tokens || 0,
        },
      }
    }
  }

  async validate(): Promise<void> {
    logger.info(`Validating AI configuration (${this.config.aiProvider}/${this.config.aiEmbedProvider})...`)
    try {
      await this.embed(['ping'])
      logger.success('AI embeddings look good.')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new AiClient.AiError(`AI validation failed: ${errorMessage}`)
    }
  }

  private async performHttpRequest(
    baseUrl: string,
    apiEndpoint: string,
    requestBody: object
  ): Promise<unknown> {
    const fullRequestUrl = `${baseUrl}${apiEndpoint}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (this.config.aiApiKey) {
      headers['Authorization'] = `Bearer ${this.config.aiApiKey}`
    }

    try {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers,
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

        errorBus.emitError(`AI HTTP ${httpResponse.status}`, undefined, {
          url: fullRequestUrl,
          body: requestBody,
          errorBody: rawErrorBody.slice(0, 500),
        })

        const errorExcerpt = rawErrorBody.slice(0, 200)
        throw new AiClient.AiError(
          `AI request failed with status ${httpResponse.status} – ${errorExcerpt}`
        )
      }

      return await httpResponse.json()
    } catch (error) {
      const isAiError = error instanceof AiClient.AiError
      if (isAiError) throw error

      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new AiClient.AiError(`Network error while calling AI: ${errorMessage}`)
    }
  }

  private parseEmbeddingsFromResponse(responseData: unknown): number[][] {
    const openAiParseResult = openAiEmbedFormatSchema.safeParse(responseData)
    if (openAiParseResult.success) {
      return openAiParseResult.data.data.map((item) => item.embedding)
    }

    const legacyParseResult = legacyEmbedFormatSchema.safeParse(responseData)
    if (legacyParseResult.success) {
      return [legacyParseResult.data.embedding]
    }

    throw new AiClient.AiError('Unexpected response format from AI embeddings endpoint')
  }
}
