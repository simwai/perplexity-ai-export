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
  private vectra: LocalIndex
  private ollama: OllamaClient

  constructor() {
    this.vectra = new LocalIndex(config.vectorIndexPath)
    this.ollama = new OllamaClient()
  }

  async validate(): Promise<void> {
    await this.ollama.validate()
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const files = this.getMarkdownFiles(config.exportDir)

    if (files.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    if (!(await this.vectra.isIndexCreated())) {
      await this.vectra.createIndex()
    }

    await this.vectra.beginUpdate()

    let pendingTexts: string[] = []
    let pendingMetas: VectorDocMeta[] = []
    const BATCH_SIZE = 10

    for (let i = 0; i < files.length; i++) {
      const path = files[i]
      if (!path) continue

      const content = readFileSync(path, 'utf-8')

      const titleMatch = content.match(/^# (.+)$/m)
      const spaceMatch = content.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)
      const idMatch = content.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)

      const title = titleMatch?.[1] ?? 'Untitled'
      const spaceName = spaceMatch?.[1] ?? 'General'
      const baseId = idMatch?.[1] ?? path

      // Use the chunker to split large files
      const chunks = chunkMarkdown(content, 1500, 100)

      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j] || ''

        pendingTexts.push(chunkText)
        pendingMetas.push({
          id: `${baseId}_part_${j}`,
          path: path,
          title: `${title} (Part ${j + 1})`,
          spaceName: spaceName,
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
    logger.success('Vector index rebuild complete.')
  }

  private async processBatch(texts: string[], metas: VectorDocMeta[]) {
    try {
      const embeddings = await this.ollama.embed(texts)

      for (let k = 0; k < embeddings.length; k++) {
        if (!embeddings[k]) continue

        await this.vectra.insertItem({
          vector: embeddings[k]!,
          metadata: metas[k]!,
        })
      }
    } catch (error) {
      logger.error(`Batch embedding failed: ${(error as Error).message}`)
    }
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    const [embedding] = await this.ollama.embed([query])
    if (!embedding) {
      return []
    }

    // Correct API signature for your Vectra version:
    // queryItems(vector, textQuery, topK, filter?)
    const results = await this.vectra.queryItems(
      embedding,
      query, // ◄─ Restored: Text query is required here
      limit
    )

    return results.map((result: any) => ({
      meta: result.item.metadata as VectorDocMeta,
      score: result.score,
    }))
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
}
