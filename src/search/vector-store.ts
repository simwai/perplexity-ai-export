import { errorBus } from '../utils/error-bus.js'
import { LocalIndex, type QueryResult } from 'vectra'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { AiClient } from '../ai/ai-client.js'
import { chunkMarkdown } from '../utils/chunking.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { ok, err, createResult, type Result } from 'super-result'

export type VectorDocMeta = Record<string, string>
export type MetadataFilter = NonNullable<Parameters<LocalIndex['queryItems']>[3]>

export interface VectorSearchResult {
  meta: VectorDocMeta
  score: number
}

export class VectorStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VectorStoreError'
  }
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VectorStoreEmbeddingError'
  }
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VectorStoreSearchError'
  }
}

export class VectorStore {
  private readonly vectorIndex: LocalIndex
  private readonly aiClient: AiClient
  private readonly resultFactory = createResult<VectorStoreError>((error: unknown) =>
    error instanceof VectorStoreError ? error : new VectorStoreError(String(error))
  )

  constructor(private readonly config: Config) {
    this.vectorIndex = new LocalIndex(config.vectorIndexPath)
    this.aiClient = new AiClient(config)
  }

  async validate(): Promise<Result<void, VectorStoreError>> {
    const result = await this.aiClient.validate()
    if (!result.ok)
      return err(
        new VectorStoreError(`Vector store validation failed: ${errorMessageOf(result.error)}`)
      )
    return ok(undefined)
  }

  async rebuildFromExports(): Promise<Result<void, VectorStoreError>> {
    logger.info('Building vector index from exports folder...')
    const markdownFilePaths = this.getMarkdownFilePathsRecursively(this.config.exportDir)

    if (markdownFilePaths.length === 0) {
      logger.warn('No markdown files found to index.')
      return ok(undefined)
    }

    const ensureResult = await this.ensureIndexExists()
    if (!ensureResult.ok) return ensureResult

    const batchResult = await this.processMarkdownFilesByBatches(markdownFilePaths)
    if (!batchResult.ok) return batchResult

    logger.success('Vector index rebuild complete.')
    return ok(undefined)
  }

  async search(query: string, limit = 10): Promise<Result<VectorSearchResult[], SearchError>> {
    const embeddingResult = await this.generateQueryEmbedding(query)
    if (!embeddingResult.ok)
      return err(new SearchError(`Vector search failed: ${errorMessageOf(embeddingResult.error)}`))

    const queryResult = await this.queryVectorIndex(embeddingResult.value, query, limit)
    if (!queryResult.ok)
      return err(new SearchError(`Vector search failed: ${errorMessageOf(queryResult.error)}`))

    return ok(this.formatVectorSearchResults(queryResult.value))
  }

  async searchWithMetadataFilter(
    query: string,
    filter: MetadataFilter,
    limit = 10
  ): Promise<Result<VectorSearchResult[], SearchError>> {
    const embeddingResult = await this.generateQueryEmbedding(query)
    if (!embeddingResult.ok)
      return err(
        new SearchError(`Filtered vector search failed: ${errorMessageOf(embeddingResult.error)}`)
      )

    const queryResult = await this.vectorIndex.queryItems<VectorDocMeta>(
      embeddingResult.value,
      query,
      limit,
      filter
    )
    return ok(this.formatVectorSearchResults(queryResult))
  }

  private async ensureIndexExists(): Promise<Result<void, VectorStoreError>> {
    const checkResult = await this.resultFactory.from(() => this.vectorIndex.isIndexCreated())
    if (!checkResult.ok) return checkResult

    if (!checkResult.value) {
      const createResult = await this.resultFactory.from(() => this.vectorIndex.createIndex())
      if (!createResult.ok) return createResult
    }
    return ok(undefined)
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

  private async processMarkdownFilesByBatches(
    filePaths: string[]
  ): Promise<Result<void, VectorStoreError>> {
    await this.vectorIndex.beginUpdate()

    const batchResult = await this.resultFactory.from(async () =>
      this.buildEmbeddingBatch(filePaths)
    )

    const endUpdateResult = await this.resultFactory.from(() => this.vectorIndex.endUpdate())
    if (!endUpdateResult.ok) {
      logger.warn(`Failed to endUpdate cleanly: ${errorMessageOf(endUpdateResult.error)}`)
      const cancelResult = await this.resultFactory.from(() => this.vectorIndex.cancelUpdate())
      if (!cancelResult.ok) {
        logger.warn(`Failed to cancelUpdate: ${errorMessageOf(cancelResult.error)}`)
      }
    }

    return batchResult
  }

  private async buildEmbeddingBatch(filePaths: string[]): Promise<void> {
    const EMBEDDING_BATCH_SIZE = 10
    let pendingTextsToEmbed: string[] = []
    let pendingMetadataToInsert: VectorDocMeta[] = []
    const batchFailures: string[] = []

    for (let i = 0; i < filePaths.length; i++) {
      const currentFilePath = filePaths[i]
      if (!currentFilePath) continue

      const { contentChunks, fileMetadata } = this.extractContentAndMetadata(currentFilePath)

      for (let chunkIndex = 0; chunkIndex < contentChunks.length; chunkIndex++) {
        const textChunk = contentChunks[chunkIndex]
        if (!textChunk) continue
        pendingTextsToEmbed.push(textChunk)
        pendingMetadataToInsert.push({
          ...fileMetadata,
          id: `${fileMetadata['id']}_part_${chunkIndex}`,
          title: `${fileMetadata['title']} (Part ${chunkIndex + 1})`,
          snippet: textChunk,
        })

        if (pendingTextsToEmbed.length >= EMBEDDING_BATCH_SIZE) {
          const batchFailure = await this.processAndInsertEmbeddingBatch(
            pendingTextsToEmbed,
            pendingMetadataToInsert
          )
          if (batchFailure) batchFailures.push(batchFailure)
          pendingTextsToEmbed = []
          pendingMetadataToInsert = []
        }
      }

      if ((i + 1) % 10 === 0) {
        logger.debug(`Processed ${i + 1}/${filePaths.length} files...`)
      }
    }

    if (pendingTextsToEmbed.length > 0) {
      const batchFailure = await this.processAndInsertEmbeddingBatch(
        pendingTextsToEmbed,
        pendingMetadataToInsert
      )
      if (batchFailure) batchFailures.push(batchFailure)
    }

    if (batchFailures.length > 0) {
      throw new VectorStoreError(
        `Index build failed: ${batchFailures.length} batch(es) dropped - ${batchFailures.join('; ')}`
      )
    }
  }

  private extractContentAndMetadata(filePath: string): {
    contentChunks: string[]
    fileMetadata: VectorDocMeta
  } {
    const fileContent = readFileSync(filePath, 'utf-8')

    const titleMatch = fileContent.match(/^# (.+)$/m)
    const spaceMatch = fileContent.match(/\*\*Space:\*\* (.+?)\s{2,}$/m)
    const idMatch = fileContent.match(/\*\*ID:\*\* (.+?)\s{2,}$/m)
    const dateMatch = fileContent.match(/\*\*Date:\*\* (.+?)\s{2,}$/m)

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
  ): Promise<string | null> {
    const embedResult = await this.aiClient.embed(batchTexts)
    if (!embedResult.ok) {
      const errorMessage = `Batch embedding failed: ${errorMessageOf(embedResult.error)}`
      errorBus.emitError(errorMessage)
      return errorMessage
    }

    const embeddingVectors = embedResult.value

    if (embeddingVectors.length !== batchMetas.length) {
      const errorMessage = `Embedding count (${embeddingVectors.length}) != metadata count (${batchMetas.length})`
      errorBus.emitError(errorMessage)
      return errorMessage
    }

    for (let i = 0; i < embeddingVectors.length; i++) {
      const currentVector = embeddingVectors[i]
      if (!currentVector) continue

      await this.vectorIndex.insertItem({
        vector: currentVector,
        metadata: batchMetas[i],
      })
    }
    return null
  }

  private async generateQueryEmbedding(query: string): Promise<Result<number[], EmbeddingError>> {
    const result = await this.aiClient.embed([query])
    if (!result.ok)
      return err(
        new EmbeddingError(
          `Failed to generate embedding for query: ${errorMessageOf(result.error)}`
        )
      )

    const [queryEmbeddingVector] = result.value
    if (!queryEmbeddingVector) {
      return err(new EmbeddingError('Failed to generate embedding for query'))
    }
    return ok(queryEmbeddingVector)
  }

  private async queryVectorIndex(
    queryEmbedding: number[],
    queryString: string,
    resultLimit: number
  ): Promise<Result<QueryResult<VectorDocMeta>[], SearchError>> {
    const searchResultFactory = createResult<SearchError>((error: unknown) =>
      error instanceof SearchError ? error : new SearchError(String(error))
    )
    return searchResultFactory.from(async () => {
      const results = await this.vectorIndex.queryItems<VectorDocMeta>(
        queryEmbedding,
        queryString,
        resultLimit
      )
      return results
    })
  }

  private formatVectorSearchResults(
    queryResults: QueryResult<VectorDocMeta>[]
  ): VectorSearchResult[] {
    return queryResults.map((result) => ({
      meta: result.item.metadata,
      score: result.score,
    }))
  }
}
