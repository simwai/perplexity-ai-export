import { errorBus } from '../utils/error-bus.js'
import { z } from 'zod'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { ok, err, from, type Result } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/api-diagnostics.js'

const embeddingItemSchema = z.object({ embedding: z.array(z.number()) }).passthrough()
const openAiEmbedFormatSchema = z.object({ data: z.array(embeddingItemSchema) }).passthrough()
const legacyEmbedFormatSchema = z.object({ embedding: z.array(z.number()) }).passthrough()

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
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string(),
          content: z.string(),
        }),
        finish_reason: z.string().optional(),
      })
    )
    .optional(),
  done: z.boolean().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
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

export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export class AiClient {
  private readonly config: Config
  private readonly diagnosticsWriter: ApiDiagnosticsWriter

  constructor(config: Config) {
    this.config = config
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
  }

  async embed(inputTexts: string[]): Promise<Result<number[][], AiError>> {
    const isInputEmpty = inputTexts.length === 0
    if (isInputEmpty) return ok([])

    const isOllama = this.config.aiEmbedProvider === 'ollama'
    const endpoint = '/v1/embeddings'
    const baseUrl = isOllama
      ? this.config.ollamaUrl
      : (this.config.aiBaseUrl ?? this.config.ollamaUrl)
    const model = this.config.aiEmbedModel ?? 'nomic-embed-text'

    const requestBody = {
      model,
      input: inputTexts,
    }

    const httpResult = await this.performHttpRequest(baseUrl, endpoint, requestBody)
    if (!httpResult.ok) return httpResult

    return this.parseEmbeddingsFromResponse(httpResult.value)
  }

  async generate(promptText: string, modelOverride?: string): Promise<Result<string, AiError>> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel ?? 'llama3.1'

    if (isOllama) {
      const requestBody = {
        model,
        prompt: promptText,
        stream: false,
      }
      const httpResult = await this.performHttpRequest(
        this.config.ollamaUrl,
        '/api/generate',
        requestBody
      )
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${this.config.ollamaUrl}/api/generate`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI generate response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok(validatedData.response || '')
    } else {
      const baseUrl = this.config.aiBaseUrl
      if (!baseUrl) return err(new AiError('AI_BASE_URL is required for external AI providers'))
      const requestBody = {
        model,
        messages: [{ role: 'user', content: promptText }],
        stream: false,
      }
      const httpResult = await this.performHttpRequest(baseUrl, '/v1/chat/completions', requestBody)
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${baseUrl}/v1/chat/completions`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI chat response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok(validatedData.choices?.[0]?.message.content || '')
    }
  }

  async generateWithUsage(
    promptText: string,
    modelOverride?: string
  ): Promise<Result<LlmResponse, AiError>> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel ?? 'llama3.1'

    if (isOllama) {
      const requestBody = {
        model,
        prompt: promptText,
        stream: false,
      }
      const httpResult = await this.performHttpRequest(
        this.config.ollamaUrl,
        '/api/generate',
        requestBody
      )
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${this.config.ollamaUrl}/api/generate`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI generate response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok({
        content: validatedData.response || '',
        usage: {
          promptTokens: validatedData.prompt_eval_count || 0,
          completionTokens: validatedData.eval_count || 0,
          totalTokens: (validatedData.prompt_eval_count || 0) + (validatedData.eval_count || 0),
        },
      })
    } else {
      const baseUrl = this.config.aiBaseUrl
      if (!baseUrl) return err(new AiError('AI_BASE_URL is required for external AI providers'))
      const requestBody = {
        model,
        messages: [{ role: 'user', content: promptText }],
        stream: false,
      }
      const httpResult = await this.performHttpRequest(baseUrl, '/v1/chat/completions', requestBody)
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${baseUrl}/v1/chat/completions`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI chat response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok({
        content: validatedData.choices?.[0]?.message.content || '',
        usage: {
          promptTokens: validatedData.usage?.prompt_tokens || 0,
          completionTokens: validatedData.usage?.completion_tokens || 0,
          totalTokens: validatedData.usage?.total_tokens || 0,
        },
      })
    }
  }

  async chat(
    messages: ChatMessage[],
    modelOverride?: string
  ): Promise<Result<LlmResponse, AiError>> {
    const isOllama = this.config.aiProvider === 'ollama'
    const model = modelOverride ?? this.config.aiModel ?? 'llama3.1'

    if (isOllama) {
      const requestBody = {
        model,
        messages,
        stream: false,
      }
      const httpResult = await this.performHttpRequest(
        this.config.ollamaUrl,
        '/api/chat',
        requestBody
      )
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${this.config.ollamaUrl}/api/chat`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI chat response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok({
        content: validatedData.message?.content || '',
        usage: {
          promptTokens: validatedData.prompt_eval_count || 0,
          completionTokens: validatedData.eval_count || 0,
          totalTokens: (validatedData.prompt_eval_count || 0) + (validatedData.eval_count || 0),
        },
      })
    } else {
      const baseUrl = this.config.aiBaseUrl
      if (!baseUrl) return err(new AiError('AI_BASE_URL is required for external AI providers'))
      const requestBody = {
        model,
        messages,
        stream: false,
      }
      const httpResult = await this.performHttpRequest(baseUrl, '/v1/chat/completions', requestBody)
      if (!httpResult.ok) return httpResult

      const parseResult = generationResponseSchema.safeParse(httpResult.value)
      if (!parseResult.success) {
        const paths = zodErrorPaths(parseResult)
        this.diagnosticsWriter.writeFailure({
          url: `${baseUrl}/v1/chat/completions`,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
        return err(new AiError(`Invalid AI chat response: ${parseResult.error.message}`))
      }

      const validatedData = parseResult.data
      return ok({
        content: validatedData.choices?.[0]?.message.content || '',
        usage: {
          promptTokens: validatedData.usage?.prompt_tokens || 0,
          completionTokens: validatedData.usage?.completion_tokens || 0,
          totalTokens: validatedData.usage?.total_tokens || 0,
        },
      })
    }
  }

  async validate(): Promise<Result<void, AiError>> {
    logger.info(
      `Validating AI configuration (${this.config.aiProvider}/${this.config.aiEmbedProvider})...`
    )
    const embedResult = await this.embed(['ping'])
    if (!embedResult.ok) {
      return err(new AiError(`AI validation failed: ${embedResult.error.message}`))
    }
    logger.success('AI embeddings look good.')
    return ok(undefined)
  }

  private async performHttpRequest(
    baseUrl: string,
    apiEndpoint: string,
    requestBody: object
  ): Promise<Result<unknown, AiError>> {
    const sanitizedBaseUrl = baseUrl.replace(/\/\/(.+):(.+)@/, '//<redacted>:<redacted>@')
    const fullRequestUrl = `${sanitizedBaseUrl}${apiEndpoint}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (this.config.aiApiKey) {
      headers['Authorization'] = `Bearer ${this.config.aiApiKey}`
    }

    return from(async () => {
      const httpResponse = await fetch(fullRequestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })

      if (!httpResponse.ok) {
        let rawErrorBody = ''
        const textResult = await from(() => httpResponse.text())
        rawErrorBody = textResult.ok ? textResult.value : ''

        const safeContext = {
          url: fullRequestUrl,
          errorBody: rawErrorBody.slice(0, 500),
        }
        errorBus.emitError(`AI HTTP ${httpResponse.status}`, undefined, safeContext)

        const errorExcerpt = rawErrorBody.slice(0, 200)
        return err(
          new AiError(`AI request failed with status ${httpResponse.status} – ${errorExcerpt}`)
        )
      }

      return await httpResponse.json()
    })
  }

  private parseEmbeddingsFromResponse(responseData: unknown): Result<number[][], AiError> {
    const openAiParseResult = openAiEmbedFormatSchema.safeParse(responseData)
    if (openAiParseResult.success) {
      return ok(openAiParseResult.data.data.map((item) => item.embedding))
    }

    const legacyParseResult = legacyEmbedFormatSchema.safeParse(responseData)
    if (legacyParseResult.success) {
      return ok([legacyParseResult.data.embedding])
    }

    const paths = zodErrorPaths(openAiParseResult)
    this.diagnosticsWriter.writeFailure({
      url: `${this.config.aiEmbedProvider === 'ollama' ? this.config.ollamaUrl : (this.config.aiBaseUrl ?? this.config.ollamaUrl)}/v1/embeddings`,
      errorType: 'zod_error',
      zodErrorPaths: paths,
    })

    return err(new AiError('Unexpected response format from AI embeddings endpoint'))
  }
}
