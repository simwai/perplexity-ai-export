import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { OllamaClient } from '../ai/ollama-client.js'
import { chunkMarkdown } from '../utils/chunking.js'

type VectorDocMeta = Record<string, string>

export interface VectorSearchResult {
  meta: VectorDocMeta
  score: number
}

export class VectorStore {
  static readonly VectorStoreError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreError'
    }
  }

  static readonly IndexError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreIndexError'
    }
  }

  static readonly EmbeddingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreEmbeddingError'
    }
  }

  static readonly SearchError = class extends Error {
    constructor(message: string) {
      super(message)
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
    } catch (_error) {
      throw new VectorStore.VectorStoreError(
        `Vector store validation failed: ${_error instanceof Error ? _error.message : String(_error)}`
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
    } catch (_error) {
      throw new VectorStore.SearchError(
        `Vector search failed: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async ensureIndexExists(): Promise<void> {
    if (!(await this.vectorIndex.isIndexCreated())) {
      await this.vectorIndex.createIndex()
    }
  }

  private getMarkdownFilesRecursively(directory: string): string[] {
    const entries = readdirSync(directory)
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = join(directory, entry)
      const fileStatus = statSync(fullPath)
      if (fileStatus.isDirectory()) {
        files.push(...this.getMarkdownFilesRecursively(fullPath))
      } else if (fileStatus.isFile() && fullPath.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  }

  private async processMarkdownFilesByBatches(files: string[]): Promise<void> {
    await this.vectorIndex.beginUpdate()
    const EMBEDDING_BATCH_SIZE = 10
    let pendingTextsToEmbed: string[] = []
    let pendingMetadataToInsert: VectorDocMeta[] = []

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]!
      const { contentChunks, fileMetadata } = this.extractContentAndMetadata(filePath)

      for (let j = 0; j < contentChunks.length; j++) {
        const textChunk = contentChunks[j]!
        pendingTextsToEmbed.push(textChunk)
        pendingMetadataToInsert.push({
          ...fileMetadata,
          id: `${fileMetadata['id']}_part_${j}`,
          title: `${fileMetadata['title']} (Part ${j + 1})`,
          snippet: textChunk,
        })

        if (pendingTextsToEmbed.length >= EMBEDDING_BATCH_SIZE) {
          await this.processAndInsertEmbeddingBatch(pendingTextsToEmbed, pendingMetadataToInsert)
          pendingTextsToEmbed = []
          pendingMetadataToInsert = []
        }
      }

      if ((i + 1) % 10 === 0) {
        logger.debug(`Processed ${i + 1}/${files.length} files...`)
      }
    }

    if (pendingTextsToEmbed.length > 0) {
      await this.processAndInsertEmbeddingBatch(pendingTextsToEmbed, pendingMetadataToInsert)
    }

    await this.vectorIndex.endUpdate()
  }

  private extractContentAndMetadata(path: string): { contentChunks: string[]; fileMetadata: VectorDocMeta } {
    const content = readFileSync(path, 'utf-8')
    const titleMatch = content.match(/^# (.+)$/m)
    const spaceMatch = content.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)
    const idMatch = content.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)

    const title = titleMatch?.[1] ?? 'Untitled'
    const spaceName = spaceMatch?.[1] ?? 'General'
    const baseId = idMatch?.[1] ?? path

    const contentChunks = chunkMarkdown(content, 1500, 100)

    return {
      contentChunks,
      fileMetadata: { id: baseId, path, title, spaceName },
    }
  }

  private async processAndInsertEmbeddingBatch(texts: string[], metas: VectorDocMeta[]): Promise<void> {
    try {
      const embeddingVectors = await this.ollamaClient.embed(texts)
      for (let k = 0; k < embeddingVectors.length; k++) {
        const vector = embeddingVectors[k]
        if (!vector) continue
        await this.vectorIndex.insertItem({
          vector,
          metadata: metas[k]!,
        })
      }
    } catch (_error) {
      logger.error(`Batch embedding failed: ${(_error as Error).message}`)
    }
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const [queryEmbedding] = await this.ollamaClient.embed([query])
    if (!queryEmbedding) {
      throw new VectorStore.EmbeddingError('Failed to generate embedding for query')
    }
    return queryEmbedding
  }

  private async queryVectorIndex(embedding: number[], query: string, limit: number): Promise<any[]> {
    return this.vectorIndex.queryItems(embedding, query, limit)
  }

  private formatVectorSearchResults(results: any[]): VectorSearchResult[] {
    return results.map((result) => ({
      meta: result.item.metadata as VectorDocMeta,
      score: result.score,
    }))
  }
}
