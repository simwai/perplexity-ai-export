import { errorBus } from '../utils/error-bus.js'
import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { type Config } from '../utils/config.js'
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

  private readonly vectorIndex: LocalIndex
  private readonly ollamaClient: OllamaClient

  constructor(private readonly config: Config) {
    this.vectorIndex = new LocalIndex(config.vectorIndexPath)
    this.ollamaClient = new OllamaClient(config)
  }

  async validate(): Promise<void> {
    try {
      await this.ollamaClient.validate()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new VectorStore.VectorStoreError(`Vector store validation failed: ${errorMessage}`)
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const markdownFilePaths = this.getMarkdownFilePathsRecursively(this.config.exportDir)

    if (markdownFilePaths.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureIndexExists()
    await this.processMarkdownFilesByBatches(markdownFilePaths)

    logger.success('Vector index rebuild complete.')
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.generateQueryEmbedding(query)
      const rawResults = await this.queryVectorIndex(queryEmbedding, query, limit)
      return this.formatVectorSearchResults(rawResults)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new VectorStore.SearchError(`Vector search failed: ${errorMessage}`)
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
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new VectorStore.SearchError(`Filtered vector search failed: ${errorMessage}`)
    }
  }

  private async ensureIndexExists(): Promise<void> {
    const isAlreadyCreated = await this.vectorIndex.isIndexCreated()
    if (!isAlreadyCreated) {
      await this.vectorIndex.createIndex()
    }
  }

  private getMarkdownFilePathsRecursively(directoryPath: string): string[] {
    const directoryEntries = readdirSync(directoryPath)
    const markdownFilePaths: string[] = []

    for (const entryName of directoryEntries) {
      const fullPath = join(directoryPath, entryName)
      const pathStatus = statSync(fullPath)

      if (pathStatus.isDirectory()) {
        markdownFilePaths.push(...this.getMarkdownFilePathsRecursively(fullPath))
      } else if (pathStatus.isFile() && fullPath.endsWith('.md')) {
        markdownFilePaths.push(fullPath)
      }
    }
    return markdownFilePaths
  }

  private async processMarkdownFilesByBatches(filePaths: string[]): Promise<void> {
    await this.vectorIndex.beginUpdate()

    const EMBEDDING_BATCH_SIZE = 10
    let pendingTextsToEmbed: string[] = []
    let pendingMetadataToInsert: VectorDocMeta[] = []

    for (let i = 0; i < filePaths.length; i++) {
      const currentFilePath = filePaths[i]!
      const { contentChunks, fileMetadata } = this.extractContentAndMetadata(currentFilePath)

      for (let chunkIndex = 0; chunkIndex < contentChunks.length; chunkIndex++) {
        const textChunk = contentChunks[chunkIndex]!
        pendingTextsToEmbed.push(textChunk)
        pendingMetadataToInsert.push({
          ...fileMetadata,
          id: `${fileMetadata['id']}_part_${chunkIndex}`,
          title: `${fileMetadata['title']} (Part ${chunkIndex + 1})`,
          snippet: textChunk,
        })

        const isBatchFull = pendingTextsToEmbed.length >= EMBEDDING_BATCH_SIZE
        if (isBatchFull) {
          await this.processAndInsertEmbeddingBatch(pendingTextsToEmbed, pendingMetadataToInsert)
          pendingTextsToEmbed = []
          pendingMetadataToInsert = []
        }
      }

      const isLogCheckpoint = (i + 1) % 10 === 0
      if (isLogCheckpoint) {
        logger.debug(`Processed ${i + 1}/${filePaths.length} files...`)
      }
    }

    const hasRemainingItems = pendingTextsToEmbed.length > 0
    if (hasRemainingItems) {
      await this.processAndInsertEmbeddingBatch(pendingTextsToEmbed, pendingMetadataToInsert)
    }

    await this.vectorIndex.endUpdate()
  }

  private extractContentAndMetadata(filePath: string): {
    contentChunks: string[]
    fileMetadata: VectorDocMeta
  } {
    const fileContent = readFileSync(filePath, 'utf-8')

    const titleMatch = fileContent.match(/^# (.+)$/m)
    const spaceMatch = fileContent.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)
    const idMatch = fileContent.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)
    const dateMatch = fileContent.match(/^\*\*Date:\*\* (.+?)\s{2,}$/m)

    const CHUNK_SIZE_CHARS = 1500
    const CHUNK_OVERLAP_CHARS = 100

    const fileMetadata: VectorDocMeta = {
      id: idMatch?.[1] ?? filePath,
      path: filePath,
      title: titleMatch?.[1] ?? 'Untitled',
      spaceName: spaceMatch?.[1] ?? 'General',
      date: dateMatch?.[1] ?? new Date().toISOString(),
    }

    const contentChunks = chunkMarkdown(fileContent, CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS)

    return { contentChunks, fileMetadata }
  }

  private async processAndInsertEmbeddingBatch(
    batchTexts: string[],
    batchMetas: VectorDocMeta[]
  ): Promise<void> {
    try {
      const embeddingVectors = await this.ollamaClient.embed(batchTexts)

      for (let i = 0; i < embeddingVectors.length; i++) {
        const currentVector = embeddingVectors[i]
        if (!currentVector) continue

        await this.vectorIndex.insertItem({
          vector: currentVector,
          metadata: batchMetas[i] as Record<string, any>,
        })
      }
    } catch (error) {
      errorBus.emitError('Batch embedding failed', error)
    }
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const [queryEmbeddingVector] = await this.ollamaClient.embed([query])
    if (!queryEmbeddingVector) {
      throw new VectorStore.EmbeddingError('Failed to generate embedding for query')
    }
    return queryEmbeddingVector
  }

  private async queryVectorIndex(
    queryEmbedding: number[],
    queryString: string,
    resultLimit: number
  ): Promise<any[]> {
    return this.vectorIndex.queryItems(queryEmbedding, queryString, resultLimit)
  }

  private formatVectorSearchResults(rawResults: any[]): VectorSearchResult[] {
    return rawResults.map((result) => ({
      meta: result.item.metadata as VectorDocMeta,
      score: result.score,
    }))
  }
}
