import { z } from 'zod'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

// Zod schemas – defined close to where they're used for clarity
const embeddingItemSchema = z.object({ embedding: z.array(z.number()) })
const openAiFormatSchema = z.object({ data: z.array(embeddingItemSchema) })
const legacyFormatSchema = z.object({ embedding: z.array(z.number()) })

export class OllamaClient {
  // ========== Custom Error Classes ==========
  /**
   * Thrown when the HTTP request to Ollama fails or returns a non‑ok status.
   */
  static readonly EmbeddingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaEmbeddingError'
    }
  }

  /**
   * Thrown when the validation step (embedding a test string) fails.
   */
  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaValidationError'
    }
  }

  /**
   * Thrown when the response from Ollama does not match any known format.
   */
  static readonly ResponseFormatError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaResponseFormatError'
    }
  }

  // ========== Public API ==========

  /**
   * Generate embeddings for a list of texts.
   * @param texts - Array of strings to embed.
   * @returns Promise resolving to an array of embedding vectors.
   * @throws {OllamaClient.EmbeddingError} if the request fails.
   * @throws {OllamaClient.ResponseFormatError} if the response format is unexpected.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const requestBody = this.createRequestBody(texts)
    const responseData = await this.fetchEmbedding(requestBody)
    return this.extractEmbeddings(responseData)
  }

  /**
   * Validate Ollama connectivity by embedding a single test string.
   * @throws {OllamaClient.ValidationError} if validation fails.
   */
  async validate(): Promise<void> {
    logger.info('Validating Ollama embedding configuration...')
    try {
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new OllamaClient.ValidationError(`Ollama validation failed: ${message}`)
    }
  }

  // ========== Private Methods ==========

  /**
   * Build the request body for the embeddings API.
   * (The `options` field is omitted because it can cause empty responses in some versions.)
   */
  private createRequestBody(texts: string[]): object {
    return {
      model: config.ollamaEmbedModel,
      input: texts,
      // options intentionally omitted – they can cause empty responses
    }
  }

  /**
   * Perform the HTTP POST to Ollama and return the parsed JSON response.
   * @throws {OllamaClient.EmbeddingError} on network errors or HTTP error responses.
   */
  private async fetchEmbedding(body: object): Promise<unknown> {
    const url = `${config.ollamaUrl}/v1/embeddings`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        await this.throwHttpError(response, body)
      }

      return await response.json()
    } catch (error) {
      // Re‑throw known errors; wrap others in EmbeddingError
      if (error instanceof OllamaClient.EmbeddingError) throw error
      throw new OllamaClient.EmbeddingError(
        `Network error while calling Ollama: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Handle a non‑ok HTTP response by logging and throwing an EmbeddingError.
   * This function never returns – it always throws.
   */
  private async throwHttpError(response: Response, body: object): Promise<never> {
    let errorBody = ''
    try {
      errorBody = await response.text()
    } catch {
      // Ignore – we already have the status
    }
    logger.error(`Ollama HTTP ${response.status}`, { body, errorBody: errorBody.slice(0, 500) })
    throw new OllamaClient.EmbeddingError(
      `Ollama embeddings failed with status ${response.status} – ${errorBody.slice(0, 200)}`
    )
  }

  /**
   * Validate and extract embeddings from the response data.
   * Tries OpenAI‑compatible format first, then the legacy single‑embedding format.
   * @throws {OllamaClient.ResponseFormatError} if neither format matches.
   */
  private extractEmbeddings(data: unknown): number[][] {
    // Try OpenAI‑compatible format first (multiple embeddings in `data` array)
    const openAiResult = openAiFormatSchema.safeParse(data)
    if (openAiResult.success) {
      return openAiResult.data.data.map((item) => item.embedding)
    }

    // Fallback to legacy format (single embedding in `embedding` field)
    const legacyResult = legacyFormatSchema.safeParse(data)
    if (legacyResult.success) {
      return [legacyResult.data.embedding]
    }

    // Both failed – build a helpful error message from Zod issues
    const issues = [...(openAiResult.error?.issues ?? []), ...(legacyResult.error?.issues ?? [])]
    const details = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new OllamaClient.ResponseFormatError(
      `Unexpected response format from Ollama embeddings endpoint: ${details}`
    )
  }
}
