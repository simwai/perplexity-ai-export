import { errorBus } from '../utils/error-bus.js'
import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import fileSystem from 'node:fs/promises'
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
  private readonly vectorIndex: LocalIndex
  private readonly ollamaClient: OllamaClient

  constructor(private readonly applicationConfig: Config) {
    this.vectorIndex = new LocalIndex(applicationConfig.vectorIndexPath)
    this.ollamaClient = new OllamaClient(applicationConfig)
  }

  async validate(): Promise<void> {
    try {
      await this.ollamaClient.validate()
    } catch (validationError) {
      errorBus.raiseError(`Vector store validation failed`, validationError)
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const markdownFilePaths = await this.discoverMarkdownFilesRecursively(
      this.applicationConfig.exportDir
    )

    if (markdownFilePaths.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureVectorIndexIsCreated()
    await this.indexFilesByBatches(markdownFilePaths)
    logger.success('Vector index rebuild complete.')
  }

  async search(searchQuery: string, resultLimit = 10): Promise<VectorSearchResult[]> {
    try {
      const [searchQueryEmbedding] = await this.ollamaClient.embed([searchQuery])
      if (!searchQueryEmbedding) {
        return errorBus.raiseError('Failed to generate embedding for query')
      }

      const rawSearchResults = await this.vectorIndex.queryItems(
        searchQueryEmbedding,
        searchQuery,
        resultLimit
      )
      return rawSearchResults.map((searchResult) => ({
        meta: searchResult.item.metadata as VectorDocMeta,
        score: searchResult.score,
      }))
    } catch (searchError) {
      return errorBus.raiseError('Vector search failed', searchError, { searchQuery })
    }
  }

  private async ensureVectorIndexIsCreated() {
    const isIndexAlreadyCreated = await this.vectorIndex.isIndexCreated()
    if (!isIndexAlreadyCreated) {
      await this.vectorIndex.createIndex()
    }
  }

  private async discoverMarkdownFilesRecursively(directoryPath: string): Promise<string[]> {
    const directoryEntries = await fileSystem.readdir(directoryPath, { withFileTypes: true })
    const markdownFilePaths: string[] = []

    for (const directoryEntry of directoryEntries) {
      const fullEntryPath = join(directoryPath, directoryEntry.name)
      if (directoryEntry.isDirectory()) {
        const nestedMarkdownPaths = await this.discoverMarkdownFilesRecursively(fullEntryPath)
        markdownFilePaths.push(...nestedMarkdownPaths)
      } else if (fullEntryPath.endsWith('.md')) {
        markdownFilePaths.push(fullEntryPath)
      }
    }
    return markdownFilePaths
  }

  private async indexFilesByBatches(markdownFilePaths: string[]) {
    await this.vectorIndex.beginUpdate()
    const EMBEDDING_BATCH_SIZE = 10
    let pendingTextChunks: string[] = []
    let pendingMetadataEntries: VectorDocMeta[] = []

    for (let fileIndex = 0; fileIndex < markdownFilePaths.length; fileIndex++) {
      const currentFilePath = markdownFilePaths[fileIndex]!
      const { markdownChunks, fileMetadata } = await this.extractChunksAndMetadata(currentFilePath)

      for (let chunkIndex = 0; chunkIndex < markdownChunks.length; chunkIndex++) {
        const textChunk = markdownChunks[chunkIndex]!
        pendingTextChunks.push(textChunk)
        pendingMetadataEntries.push({
          ...fileMetadata,
          id: `${fileMetadata['id']}_p${chunkIndex}`,
          title: `${fileMetadata['title']} (Part ${chunkIndex + 1})`,
          snippet: textChunk,
        })

        if (pendingTextChunks.length >= EMBEDDING_BATCH_SIZE) {
          await this.insertEmbeddingBatchIntoIndex(pendingTextChunks, pendingMetadataEntries)
          pendingTextChunks = []
          pendingMetadataEntries = []
        }
      }

      const LOGGING_FREQUENCY = 10
      if ((fileIndex + 1) % LOGGING_FREQUENCY === 0) {
        logger.debug(`Processed ${fileIndex + 1}/${markdownFilePaths.length} files...`)
      }
    }

    if (pendingTextChunks.length > 0) {
      await this.insertEmbeddingBatchIntoIndex(pendingTextChunks, pendingMetadataEntries)
    }
    await this.vectorIndex.endUpdate()
  }

  private async extractChunksAndMetadata(filePath: string) {
    const fileContent = await fileSystem.readFile(filePath, 'utf-8')
    const fileMetadata = {
      id: fileContent.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)?.[1] ?? filePath,
      path: filePath,
      title: fileContent.match(/^# (.+)$/m)?.[1] ?? 'Untitled',
      spaceName: fileContent.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)?.[1] ?? 'General',
      date: fileContent.match(/^\*\*Date:\*\* (.+?)\s{2,}$/m)?.[1] ?? new Date().toISOString(),
    }
    const MAXIMUM_CHARS_PER_CHUNK = 1500
    const OVERLAP_CHARS_BETWEEN_CHUNKS = 100
    return {
      markdownChunks: chunkMarkdown(
        fileContent,
        MAXIMUM_CHARS_PER_CHUNK,
        OVERLAP_CHARS_BETWEEN_CHUNKS
      ),
      fileMetadata,
    }
  }

  private async insertEmbeddingBatchIntoIndex(
    textChunks: string[],
    metadataEntries: VectorDocMeta[]
  ) {
    try {
      const embeddingVectors = await this.ollamaClient.embed(textChunks)
      for (let vectorIndex = 0; vectorIndex < embeddingVectors.length; vectorIndex++) {
        const vector = embeddingVectors[vectorIndex]
        if (vector) {
          await this.vectorIndex.insertItem({
            vector: vector,
            metadata: metadataEntries[vectorIndex] as any,
          })
        }
      }
    } catch (embeddingError) {
      errorBus.emitError('Batch embedding failed', embeddingError)
    }
  }
}
