import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

interface OllamaEmbeddingResponse {
  embedding: number[]
  data: Array<{ embedding: number[] }>
}

export class OllamaClient {
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const url = `${config.ollamaUrl}/v1/embeddings`

    // Fix 1: Explicitly request larger context window
    // nomic-embed-text supports 8192, we ask for it to be safe
    const body = {
      model: config.ollamaEmbedModel,
      input: texts,
      options: {
        num_ctx: 8192,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')

      // Detailed error logging
      console.error(`Ollama Embed Error: ${response.status} ${response.statusText}`)
      console.error(`Payload size: ${texts.length} texts`)
      console.error(`Max text length: ${Math.max(...texts.map((t) => t.length))}`)

      throw new Error(
        `Ollama embeddings failed (${response.status}): ${errorText || response.statusText}`
      )
    }

    const json = (await response.json()) satisfies OllamaEmbeddingResponse

    // Fix 2: Handle OpenAI-compatible response format correctly
    if (json.data && Array.isArray(json.data)) {
      return json.data.map((item: { embedding: any }) => item.embedding)
    }

    // Fallback for older Ollama versions/formats
    if (json.embedding) {
      return [json.embedding]
    }

    throw new Error('Unexpected response format from Ollama embeddings endpoint')
  }

  async validate(): Promise<void> {
    try {
      logger.info('Validating Ollama embedding configuration...')
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Ollama validation failed: ${message}`)
    }
  }
}
