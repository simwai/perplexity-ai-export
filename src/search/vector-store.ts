import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { OllamaClient } from '../ai/ollama-client.js'
import { chunkMarkdown } from '../utils/chunking.js'

export type VectorDocMeta = Record<string, string>

export interface VectorSearchResult {
  meta: VectorDocMeta
  score: number
}

export class VectorStore {
  static readonly VectorStoreError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'VectorStoreError'
    }
  }

  static readonly IndexError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'VectorStoreIndexError'
    }
  }

  static readonly EmbeddingError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'VectorStoreEmbeddingError'
    }
  }

  static readonly SearchError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'VectorStoreSearchError'
    }
  }

  private vectorIndex: LocalIndex
  private ollamaClient: OllamaClient

  constructor() {
    this.vectorIndex = new LocalIndex(config.vectorIndexPath)
    this.ollamaClient = new OllamaClient()
  }

  async validate(): Promise<void> {
    try {
      await this.ollamaClient.validate()
    } catch (error) {
      throw new VectorStore.VectorStoreError(
        `Vector store validation failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const markdownFiles = this.getMarkdownFilesRecursively(config.exportDir)

    if (markdownFiles.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureIndexExists()
    await this.processMarkdownFilesByBatches(markdownFiles)

    logger.success('Vector index rebuild complete.')
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.generateQueryEmbedding(query)
      const rawResults = await this.queryVectorIndex(queryEmbedding, query, limit)
      return this.formatVectorSearchResults(rawResults)
    } catch (error) {
      throw new VectorStore.SearchError(
        `Vector search failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }

  async searchWithMetadataFilter(
    query: string,
    filter: (meta: Record<string, any>) => boolean,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.generateQueryEmbedding(query)
      const rawResults = await this.vectorIndex.queryItems(
        queryEmbedding,
        query,
        limit,
        filter as any
      )
      return this.formatVectorSearchResults(rawResults)
    } catch (error) {
      throw new VectorStore.SearchError(
        `Filtered vector search failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }

  private async ensureIndexExists(): Promise<void> {
    if (!(await this.vectorIndex.isIndexCreated())) {
      await this.vectorIndex.createIndex()
    }
  }

  private async processMarkdownFilesByBatches(files: string[]): Promise<void> {
    const batchSize = 10
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const batchData = batch.map((f) => this.readAndChunkMarkdownFile(f))

      const texts: string[] = []
      const metas: VectorDocMeta[] = []

      for (const item of batchData) {
        for (const chunk of item.contentChunks) {
          texts.push(chunk)
          metas.push(item.fileMetadata)
        }
      }

      await this.processAndInsertEmbeddingBatch(texts, metas)
      logger.info(`Indexed batch ${Math.floor(i / batchSize) + 1} (${batch.length} files)`)
    }
  }

  private async processAndInsertEmbeddingBatch(
    texts: string[],
    metas: VectorDocMeta[]
  ): Promise<void> {
    try {
      const embeddingVectors = await this.ollamaClient.embed(texts)
      for (let k = 0; k < embeddingVectors.length; k++) {
        const vector = embeddingVectors[k]
        if (!vector) continue
        await this.vectorIndex.insertItem({
          vector,
          metadata: metas[k] as Record<string, any>,
        })
      }
    } catch (error) {
      logger.error(`Batch embedding failed: ${error instanceof Error ? error.message : String(error)}`, error)
    }
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const [queryEmbedding] = await this.ollamaClient.embed([query])
    if (!queryEmbedding) {
      throw new VectorStore.EmbeddingError('Failed to generate embedding for query')
    }
    return queryEmbedding
  }

  private async queryVectorIndex(
    queryEmbedding: number[],
    query: string,
    limit: number
  ): Promise<any[]> {
    try {
      return await this.vectorIndex.queryItems(queryEmbedding, query, limit)
    } catch (error) {
      throw new VectorStore.IndexError(`Vectra index query failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  private formatVectorSearchResults(rawResults: any[]): VectorSearchResult[] {
    return rawResults.map((res: any) => ({
      meta: res.item.metadata,
      score: res.score,
    }))
  }

  private getMarkdownFilesRecursively(dir: string): string[] {
    const results: string[] = []
    const list = readdirSync(dir)

    list.forEach((file) => {
      const filePath = join(dir, file)
      const stat = statSync(filePath)
      if (stat && stat.isDirectory()) {
        results.push(...this.getMarkdownFilesRecursively(filePath))
      } else if (file.endsWith('.md')) {
        results.push(filePath)
      }
    })

    return results
  }

  private readAndChunkMarkdownFile(path: string): {
    contentChunks: string[]
    fileMetadata: VectorDocMeta
  } {
    const content = readFileSync(path, 'utf-8')
    const fileName = path.split('/').pop() || 'Untitled'
    const baseId = fileName.match(/\(([^)]+)\)\.md$/)?.[1] || 'unknown'
    const title = fileName.replace(/ \([^)]+\)\.md$/, '')
    const spaceName = path.split('/').slice(-2, -1)[0] || 'Unknown'
    const dateIso = new Date().toISOString()

    const contentChunks = chunkMarkdown(content, 1500, 100)

    return {
      contentChunks,
      fileMetadata: { id: baseId, path, title, spaceName, date: dateIso },
    }
  }
}
