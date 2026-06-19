import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { VectorStore } from '../../src/search/vector-store.js'
import { SearchOrchestrator } from '../../src/search/search-orchestrator.js'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { RgSearch } from '../../src/search/rg-search.js'
import { type Config } from '../../src/utils/config.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_STORAGE_DIR = join(__dirname, '../../.test-storage-search')
const EXPORTS_DIR = join(TEST_STORAGE_DIR, 'exports')

const mockApplicationConfig: Config = {
  authStoragePath: join(TEST_STORAGE_DIR, 'auth.json'),
  waitMode: 'static',
  rateLimitMs: 10,
  parallelWorkers: 1,
  checkpointSaveInterval: 1,
  exportDir: EXPORTS_DIR,
  checkpointPath: join(TEST_STORAGE_DIR, 'checkpoint.json'),
  vectorIndexPath: join(TEST_STORAGE_DIR, 'vector-index'),
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  ollamaEmbedModel: 'nomic-embed-text',
  enableVectorSearch: true,
  headless: true,
  debug: false,
}

describe('Search Engine Integration', () => {
  beforeAll(() => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    mkdirSync(EXPORTS_DIR, { recursive: true })

    const codingDir = join(EXPORTS_DIR, 'Coding')
    mkdirSync(codingDir, { recursive: true })

    writeFileSync(
      join(codingDir, 'Refactoring (thread-1).md'),
      `# The Great Refactor\n\n**Space:** Coding  \n**ID:** thread-1  \n**Date:** 2026-06-01T12:00:00.000Z  \n\n## Question\nHow do I refactor?\n\nAnswer: Use small steps.`
    )
  })

  afterAll(() => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('should successfully index and search using VectorStore (Ollama mocked)', async () => {
    const embedSpy = vi
      .spyOn(OllamaClient.prototype, 'embed')
      .mockImplementation(async (texts: string[]) => {
        return texts.map((text) => {
          if (text.toLowerCase().includes('refactor')) return [1, 0, 0]
          return [0, 0, 1]
        })
      })

    const vectorStore = new VectorStore(mockApplicationConfig)
    await vectorStore.rebuildFromExports()

    const searchResults = await vectorStore.search('refactor')

    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0]!.meta['title']).toContain('The Great Refactor')

    embedSpy.mockRestore()
  })

  it('should find content using ripgrep (RgSearch)', async () => {
    const ripgrepSearch = new RgSearch(mockApplicationConfig)
    const searchMatches = await ripgrepSearch.captureSearchMatches({ pattern: 'refactor' })
    expect(searchMatches.length).toBeGreaterThan(0)
  })

  it('should coordinate searches correctly via SearchOrchestrator', async () => {
    const orchestrator = new SearchOrchestrator(mockApplicationConfig)
    const vectorSearchSpy = vi
      .spyOn(VectorStore.prototype, 'search')
      .mockResolvedValue([
        { meta: { spaceName: 'Coding', title: 'Vector Result', path: 'path' }, score: 0.99 },
      ])

    await orchestrator.search('short', 'auto', { pattern: 'short' })
    expect(vectorSearchSpy).not.toHaveBeenCalled()

    await orchestrator.search('this is a very long query about refactoring', 'auto', {
      pattern: 'this is a very long query about refactoring',
    })
    expect(vectorSearchSpy).toHaveBeenCalled()

    vectorSearchSpy.mockRestore()
  })
})
