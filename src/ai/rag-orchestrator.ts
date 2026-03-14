import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

export class RagOrchestrator {
  private vectorStore: VectorStore
  private ollamaClient: OllamaClient

  constructor() {
    this.vectorStore = new VectorStore()
    this.ollamaClient = new OllamaClient()
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Answering question with RAG: "${question}"`)

    try {
      const relevantChunks = await this.vectorStore.search(question, 5)

      if (relevantChunks.length === 0) {
        logger.warn('No relevant context found in your exports. Attempting to answer without context...')
      }

      const prompt = this.constructRagPrompt(question, relevantChunks)

      logger.info('Generating response...')
      const response = await this.ollamaClient.generate(prompt)

      console.log(`\n${chalk.bold.green('AI Response:')}\n`)
      console.log(response)

      if (relevantChunks.length > 0) {
        this.displaySources(relevantChunks)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`RAG process failed: ${errorMessage}`)
    }
  }

  private constructRagPrompt(question: string, contextChunks: VectorSearchResult[]): string {
    const contextText = contextChunks
      .map((chunk, index) => {
        const sourceReferenceNumber = index + 1
        return `Source [${sourceReferenceNumber}]: ${chunk.meta['path']}\nContent: ${chunk.meta['snippet']}`
      })
      .join('\n\n---\n\n')

    return `
You are a helpful assistant. Use the following context retrieved from the user's Perplexity history to answer the question.
If the context doesn't contain the answer, use your general knowledge but mention that it's not in the history.
Always cite your sources using [1], [2], etc. based on the Source number provided.

Context:
${contextText}

Question: ${question}

Answer:`
  }

  private displaySources(chunks: VectorSearchResult[]): void {
    console.log(`\n${chalk.bold.cyan('Sources:')}`)
    chunks.forEach((chunk, index) => {
      const sourceReferenceNumber = index + 1
      console.log(`[${sourceReferenceNumber}] ${chunk.meta['title']} (${chunk.meta['path']})`)
    })
    console.log('')
  }
}
