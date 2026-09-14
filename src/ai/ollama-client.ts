import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { createResult, ok, err, from, type Result } from 'super-result'

const OLLAMA_REQUEST_TIMEOUT_MS = 120_000

const embeddingItemSchema = z.object({ embedding: z.array(z.number()) })
const openAiFormatSchema = z.object({ data: z.array(embeddingItemSchema) })
const legacyFormatSchema = z.object({ embedding: z.array(z.number()) })

const generationResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  response: z.string().optional(),
  message: z
    .object({
      role: z.string(),
      content: z.string(),
    })
    .optional(),
  done: z.boolean(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
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

export class OllamaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OllamaError'
  }
}

export class OllamaClient {
  private readonly resultFactory = createResult<OllamaError>((error: unknown) =>
    error instanceof OllamaError ? error : new OllamaError(String(error))
  )

  constructor(private readonly config: Config) {}

  async embed(inputTexts: string[]): Promise<Result<number[][], OllamaError>> {
    if (inputTexts.length === 0) return ok([])

    const requestBody = {
      model: this.config.ollamaEmbedModel,
      input: inputTexts,
    }

    const httpResult = await this.performOllamaHttpRequest('/v1/embeddings', requestBody)
    if (!httpResult.ok) return httpResult

    return this.parseEmbeddingsFromResponse(httpResult.value)
  }

  async generate(promptText: string, modelOverride?: string): Promise<Result<string, OllamaError>> {
    const requestBody = {
      model: modelOverride ?? this.config.ollamaModel,
      prompt: promptText,
      stream: false,
    }

    const httpResult = await this.performOllamaHttpRequest('/api/generate', requestBody)
    if (!httpResult.ok) return httpResult

    const parseResult = this.resultFactory.from(() =>
      generationResponseSchema.parse(httpResult.value)
    )
    if (!parseResult.ok) return parseResult

    return ok(parseResult.value.response || '')
  }

  async generateWithUsage(
    promptText: string,
    modelOverride?: string
  ): Promise<Result<LlmResponse, OllamaError>> {
    const requestBody = {
      model: modelOverride ?? this.config.ollamaModel,
      prompt: promptText,
      stream: false,
    }

    const httpResult = await this.performOllamaHttpRequest('/api/generate', requestBody)
    if (!httpResult.ok) return httpResult

    const parseResult = this.resultFactory.from(() =>
      generationResponseSchema.parse(httpResult.value)
    )
    if (!parseResult.ok) return parseResult

    const data = parseResult.value
    return ok({
      content: data.response || '',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    })
  }

  async chat(
    messages: ChatMessage[],
    modelOverride?: string
  ): Promise<Result<LlmResponse, OllamaError>> {
    const requestBody = {
      model: modelOverride ?? this.config.ollamaModel,
      messages,
      stream: false,
    }

    const httpResult = await this.performOllamaHttpRequest('/api/chat', requestBody)
    if (!httpResult.ok) return httpResult

    const parseResult = this.resultFactory.from(() =>
      generationResponseSchema.parse(httpResult.value)
    )
    if (!parseResult.ok) return parseResult

    const data = parseResult.value
    return ok({
      content: data.message?.content || '',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    })
  }

  async validate(): Promise<Result<void, OllamaError>> {
    logger.info('Validating Ollama configuration...')
    const embedResult = await this.embed(['ping'])
    if (!embedResult.ok) return embedResult

    logger.success('Ollama embeddings look good.')
    return ok(undefined)
  }

  private async performOllamaHttpRequest(
    apiEndpoint: string,
    requestBody: object
  ): Promise<Result<unknown, OllamaError>> {
    const fullRequestUrl = `${this.config.ollamaUrl}${apiEndpoint}`

    return from(async () => {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
      })

      if (!httpResponse.ok) {
        const rawErrorBody = await httpResponse.text().catch(() => '')

        errorBus.emitError(`Ollama HTTP ${httpResponse.status}`, undefined, {
          body: requestBody,
          errorBody: rawErrorBody.slice(0, 500),
        })

        const errorExcerpt = rawErrorBody.slice(0, 200)
        return err(
          new OllamaError(
            `Ollama request failed with status ${httpResponse.status} – ${errorExcerpt}`
          )
        )
      }

      return httpResponse.json()
    })
  }

  private parseEmbeddingsFromResponse(responseData: unknown): Result<number[][], OllamaError> {
    const openAiParseResult = openAiFormatSchema.safeParse(responseData)
    if (openAiParseResult.success) {
      return ok(openAiParseResult.data.data.map((item) => item.embedding))
    }

    const legacyParseResult = legacyFormatSchema.safeParse(responseData)
    if (legacyParseResult.success) {
      return ok([legacyParseResult.data.embedding])
    }

    return err(new OllamaError('Unexpected response format from Ollama embeddings endpoint'))
  }
}
