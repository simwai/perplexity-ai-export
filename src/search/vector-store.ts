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
  // ========== Custom Error Classes ==========
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

  private vectra: LocalIndex
  private ollama: OllamaClient

  constructor() {
    this.vectra = new LocalIndex(config.vectorIndexPath)
    this.ollama = new OllamaClient()
  }

  async validate(): Promise<void> {
    try {
      await this.ollama.validate()
    } catch (error) {
      throw new VectorStore.VectorStoreError(
        `Vector store validation failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const files = this.getMarkdownFiles(config.exportDir)

    if (files.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureIndex()
    await this.processFilesInBatches(files)

    logger.success('Vector index rebuild complete.')
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    try {
      const embedding = await this.getQueryEmbedding(query)
      const results = await this.queryIndex(embedding, query, limit)
      return this.formatResults(results)
    } catch (error) {
      throw new VectorStore.SearchError(
        `Vector search failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // ========== Private Methods ==========

  private async ensureIndex(): Promise<void> {
    if (!(await this.vectra.isIndexCreated())) {
      await this.vectra.createIndex()
    }
  }

  private getMarkdownFiles(dir: string): string[] {
    const entries = readdirSync(dir)
    const files: string[] = []

    for (const entry of entries) {
      const full = join(dir, entry)
      const stats = statSync(full)
      if (stats.isDirectory()) {
        files.push(...this.getMarkdownFiles(full))
      } else if (stats.isFile() && full.endsWith('.md')) {
        files.push(full)
      }
    }
    return files
  }

  private async processFilesInBatches(files: string[]): Promise<void> {
    await this.vectra.beginUpdate()
    const BATCH_SIZE = 10
    let pendingTexts: string[] = []
    let pendingMetas: VectorDocMeta[] = []

    for (let i = 0; i < files.length; i++) {
      const path = files[i]!
      const { chunks, baseMeta } = this.processFile(path)

      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j]!
        pendingTexts.push(chunkText)
        pendingMetas.push({
          ...baseMeta,
          id: `${baseMeta.id}_part_${j}`,
          title: `${baseMeta.title} (Part ${j + 1})`,
          snippet: chunkText,
        })

        if (pendingTexts.length >= BATCH_SIZE) {
          await this.processBatch(pendingTexts, pendingMetas)
          pendingTexts = []
          pendingMetas = []
        }
      }

      if ((i + 1) % 10 === 0) {
        logger.debug(`Processed ${i + 1}/${files.length} files...`)
      }
    }

    if (pendingTexts.length > 0) {
      await this.processBatch(pendingTexts, pendingMetas)
    }

    await this.vectra.endUpdate()
  }

  private processFile(path: string): { chunks: string[]; baseMeta: VectorDocMeta } {
    const content = readFileSync(path, 'utf-8')
    const titleMatch = content.match(/^# (.+)$/m)
    const spaceMatch = content.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)
    const idMatch = content.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)

    const title = titleMatch?.[1] ?? 'Untitled'
    const spaceName = spaceMatch?.[1] ?? 'General'
    const baseId = idMatch?.[1] ?? path

    const chunks = chunkMarkdown(content, 1500, 100)

    return {
      chunks,
      baseMeta: { id: baseId, path, title, spaceName },
    }
  }

  private async processBatch(texts: string[], metas: VectorDocMeta[]): Promise<void> {
    try {
      const embeddings = await this.ollama.embed(texts)
      for (let k = 0; k < embeddings.length; k++) {
        const vector = embeddings[k]
        if (!vector) continue
        await this.vectra.insertItem({
          vector,
          metadata: metas[k]!,
        })
      }
    } catch (error) {
      logger.error(`Batch embedding failed: ${(error as Error).message}`)
    }
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    const [embedding] = await this.ollama.embed([query])
    if (!embedding) {
      throw new VectorStore.EmbeddingError('Failed to generate embedding for query')
    }
    return embedding
  }

  private async queryIndex(embedding: number[], query: string, limit: number): Promise<any[]> {
    // Vectra API expects (vector, textQuery, topK, filter?)
    return this.vectra.queryItems(embedding, query, limit)
  }

  private formatResults(results: any[]): VectorSearchResult[] {
    return results.map((result) => ({
      meta: result.item.metadata as VectorDocMeta,
      score: result.score,
    }))
  }
}
