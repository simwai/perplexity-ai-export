import { errorBus } from '../utils/error-bus.js'
import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import fs from 'node:fs/promises'
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

  constructor(private readonly config: Config) {
    this.vectorIndex = new LocalIndex(config.vectorIndexPath)
    this.ollamaClient = new OllamaClient(config)
  }

  async validate(): Promise<void> {
    try {
      await this.ollamaClient.validate()
    } catch (error) {
      throw new Error(`Vector store validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const paths = await this.getMdPaths(this.config.exportDir)
    if (paths.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureIndex()
    await this.processBatches(paths)
    logger.success('Vector index rebuild complete.')
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    const [embedding] = await this.ollamaClient.embed([query])
    if (!embedding) throw new Error('Failed to generate embedding for query')
    const raw = await this.vectorIndex.queryItems(embedding, query, limit)
    return raw.map(r => ({ meta: r.item.metadata as VectorDocMeta, score: r.score }))
  }

  private async ensureIndex() {
    if (!(await this.vectorIndex.isIndexCreated())) await this.vectorIndex.createIndex()
  }

  private async getMdPaths(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const paths: string[] = []
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) paths.push(...(await this.getMdPaths(full)))
      else if (full.endsWith('.md')) paths.push(full)
    }
    return paths
  }

  private async processBatches(paths: string[]) {
    await this.vectorIndex.beginUpdate()
    const BATCH = 10
    let texts: string[] = []
    let metas: VectorDocMeta[] = []

    for (let i = 0; i < paths.length; i++) {
      const { chunks, meta } = await this.extract(paths[i]!)
      for (const [idx, chunk] of chunks.entries()) {
        texts.push(chunk)
        metas.push({ ...meta, id: `${meta['id']}_p${idx}`, title: `${meta['title']} (Part ${idx + 1})`, snippet: chunk })
        if (texts.length >= BATCH) {
          await this.insertBatch(texts, metas)
          texts = []; metas = []
        }
      }
      if ((i + 1) % 10 === 0) logger.debug(`Processed ${i + 1}/${paths.length} files...`)
    }
    if (texts.length > 0) await this.insertBatch(texts, metas)
    await this.vectorIndex.endUpdate()
  }

  private async extract(path: string) {
    const content = await fs.readFile(path, 'utf-8')
    const meta = {
      id: content.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)?.[1] ?? path,
      path: path,
      title: content.match(/^# (.+)$/m)?.[1] ?? 'Untitled',
      spaceName: content.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)?.[1] ?? 'General',
      date: content.match(/^\*\*Date:\*\* (.+?)\s{2,}$/m)?.[1] ?? new Date().toISOString(),
    }
    return { chunks: chunkMarkdown(content, 1500, 100), meta }
  }

  private async insertBatch(texts: string[], metas: VectorDocMeta[]) {
    try {
      const vecs = await this.ollamaClient.embed(texts)
      for (let i = 0; i < vecs.length; i++) {
        if (vecs[i]) await this.vectorIndex.insertItem({ vector: vecs[i]!, metadata: metas[i] as any })
      }
    } catch (e) {
      errorBus.emitError('Batch embedding failed', e)
    }
  }
}
