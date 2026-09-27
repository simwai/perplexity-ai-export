import { errorBus } from '../utils/logging/error-bus.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logging/logger.js'
import { ok, err, type Result } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/logging/api-diagnostics.js'
import { errorMessageOf } from '../utils/extract-error-message.js'

const OLLAMA_REQUEST_TIMEOUT_MS = 120_000

const embeddingItemSchema = z.object({ embedding: z.array(z.number()) }).passthrough()
const openAiFormatSchema = z.object({ data: z.array(embeddingItemSchema).optional() }).passthrough()
const legacyFormatSchema = z.object({ embedding: z.array(z.number()) }).passthrough()

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
  private readonly config: Config
  private readonly diagnosticsWriter: ApiDiagnosticsWriter

  constructor(config: Config) {
    this.config = config
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
  }

  async embed(inputTexts: string[]): Promise<Result<number[][], OllamaError>> {
    if (inputTexts.length === 0) return ok([])

    const requestBody = {
      model: this.config.ollamaEmbedModel,
      input: inputTexts,
    }

    const httpResult = await this.performOllamaHttpRequest('/v1/embeddings', requestBody)
    if (!httpResult.ok) return httpResult

    return this.parseEmbeddingsFromResponse(httpResult.value.data, httpResult.value.rawText)
  }

  async generate(promptText: string, modelOverride?: string): Promise<Result<string, OllamaError>> {
    const requestBody = {
      model: modelOverride ?? this.config.ollamaModel,
      prompt: promptText,
      stream: false,
    }

    const httpResult = await this.performOllamaHttpRequest('/api/generate', requestBody)
    if (!httpResult.ok) return httpResult

    const parseResult = generationResponseSchema.safeParse(httpResult.value.data)
    if (!parseResult.success) {
      const paths = zodErrorPaths(parseResult, httpResult.value.rawText)
      this.diagnosticsWriter.writeFailure({
        url: `${this.config.ollamaUrl}/api/generate`,
        errorType: 'zod_error',
        zodErrorDetails: paths,
        rawResponse: httpResult.value.rawText,
      })
      return err(new OllamaError(`Invalid generate response: ${parseResult.error.message}`))
    }

    return ok(parseResult.data.response || '')
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

    const parseResult = generationResponseSchema.safeParse(httpResult.value.data)
    if (!parseResult.success) {
      const paths = zodErrorPaths(parseResult, httpResult.value.rawText)
      this.diagnosticsWriter.writeFailure({
        url: `${this.config.ollamaUrl}/api/generate`,
        errorType: 'zod_error',
        zodErrorDetails: paths,
        rawResponse: httpResult.value.rawText,
      })
      return err(new OllamaError(`Invalid generate response: ${parseResult.error.message}`))
    }

    const data = parseResult.data
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

    const parseResult = generationResponseSchema.safeParse(httpResult.value.data)
    if (!parseResult.success) {
      const paths = zodErrorPaths(parseResult, httpResult.value.rawText)
      this.diagnosticsWriter.writeFailure({
        url: `${this.config.ollamaUrl}/api/chat`,
        errorType: 'zod_error',
        zodErrorDetails: paths,
        rawResponse: httpResult.value.rawText,
      })
      return err(new OllamaError(`Invalid chat response: ${parseResult.error.message}`))
    }

    const data = parseResult.data
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

    logger.info('Ollama embeddings look good.')
    return ok(undefined)
  }

  private async performOllamaHttpRequest(
    apiEndpoint: string,
    requestBody: object
  ): Promise<Result<{ data: unknown; rawText: string }, OllamaError>> {
    const fullRequestUrl = `${this.config.ollamaUrl}${apiEndpoint}`

    try {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
      })

      const rawText = await httpResponse.text()

      if (!httpResponse.ok) {
        errorBus.emitError(`Ollama HTTP ${httpResponse.status}`, undefined, {
          body: requestBody,
          errorBody: rawText.slice(0, 500),
        })

        const errorExcerpt = rawText.slice(0, 200)
        return err(
          new OllamaError(
            `Ollama request failed with status ${httpResponse.status} – ${errorExcerpt}`
          )
        )
      }

      let data: unknown
      try {
        data = JSON.parse(rawText)
      } catch {
        data = rawText
      }

      return ok({ data, rawText })
    } catch (error) {
      return err(new OllamaError(`Ollama request failed: ${errorMessageOf(error)}`))
    }
  }

  private parseEmbeddingsFromResponse(
    responseData: unknown,
    rawText: string
  ): Result<number[][], OllamaError> {
    const openAiParseResult = openAiFormatSchema.safeParse(responseData)
    if (openAiParseResult.success && openAiParseResult.data.data) {
      return ok(openAiParseResult.data.data.map((item) => item.embedding))
    }

    const legacyParseResult = legacyFormatSchema.safeParse(responseData)
    if (legacyParseResult.success) {
      return ok([legacyParseResult.data.embedding])
    }

    const paths = zodErrorPaths(openAiParseResult, rawText)
    this.diagnosticsWriter.writeFailure({
      url: `${this.config.ollamaUrl}/v1/embeddings`,
      errorType: 'zod_error',
      zodErrorDetails: paths,
      rawResponse: rawText,
    })

    return err(new OllamaError('Unexpected response format from Ollama embeddings endpoint'))
  }
}
