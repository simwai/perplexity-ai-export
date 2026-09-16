import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { VectorStore } from '../../src/search/vector-store.js'
import { AiClient } from '../../src/ai/ai-client.js'
import { ok } from 'super-result'

const TEST_EXPORTS = join(process.cwd(), 'test-fixtures', 'exports-mocked')
const TEST_INDEX = join(process.cwd(), 'test-fixtures', 'vector-index-mocked')

const mockConfig = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  ollamaEmbedModel: 'nomic-embed-text',
  aiProvider: 'ollama' as const,
  aiEmbedProvider: 'ollama' as const,
  exportDir: TEST_EXPORTS,
  vectorIndexPath: TEST_INDEX,
  debug: false,
  authStoragePath: join(process.cwd(), '.storage', 'auth.json'),
  checkpointPath: join(process.cwd(), '.storage', 'checkpoint.json'),
  waitMode: 'dynamic',
  rateLimitMs: 500,
  parallelWorkers: 5,
  extractionConcurrency: 2,
  checkpointSaveInterval: 10,
  aiProvider: 'ollama' as const,
  aiEmbedProvider: 'ollama' as const,
  aiBaseUrl: undefined,
  aiApiKey: undefined,
  aiModel: undefined,
  aiEmbedModel: undefined,
  enableVectorSearch: undefined,
  headless: false,
  hydeMode: 'supplement' as const,
  hydeThresholdScore: 0.7,
  hydeThresholdCount: 5,
  exportStrategies: ['markdown'],
}

describe('VectorStore (Mocked Embeddings)', () => {
  const mockEmbed = vi.fn()

  beforeAll(async () => {
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
      mkdirSync(dir, { recursive: true })
    })
  })

  afterAll(() => {
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    })
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockEmbed.mockReset()

    vi.spyOn(AiClient.prototype, 'embed').mockImplementation(mockEmbed)

    // Clean any files left by previous tests so empty-dir tests stay empty
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (!existsSync(dir)) return
      const files = readdirSync(dir)
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.json')) {
          rmSync(join(dir, file))
        }
      }
    })
  })

  it('should build index from markdown files with mocked embeddings', async () => {
    mockEmbed.mockResolvedValue(ok([[0.1, 0.2, 0.3]]))

    const store = new VectorStore(mockConfig)

    writeFileSync(
      join(TEST_EXPORTS, 'test-conv.md'),
      `# Test Conversation\n\n**Space:** General\n**ID:** test-123\n\n## Question\n\nWhat is testing?\n\n---\n\n## Answer\n\nTesting verifies software behavior.`
    )

    await store.rebuildFromExports()

    expect(existsSync(join(TEST_INDEX, 'index.json'))).toBe(true)

    const indexContent = readFileSync(join(TEST_INDEX, 'index.json'), 'utf-8')
    expect(indexContent.length).toBeGreaterThan(100)
  })

  it('should chunk large files automatically during indexing', async () => {
    mockEmbed.mockResolvedValue(ok([[0.1, 0.2, 0.3]]))

    const store = new VectorStore(mockConfig)

    const largeContent = `# Large File\n\n**Space:** Test\n**ID:** large-1\n\n${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(100)}`
    writeFileSync(join(TEST_EXPORTS, 'large.md'), largeContent)

    await store.rebuildFromExports()

    expect(existsSync(join(TEST_INDEX, 'index.json'))).toBe(true)
  })

  it('should search and return relevant results with scores', async () => {
    mockEmbed
      .mockResolvedValueOnce(ok([[0.1, 0.2, 0.3]]))
      .mockResolvedValueOnce(ok([[0.1, 0.2, 0.3]]))

    const store = new VectorStore(mockConfig)

    writeFileSync(
      join(TEST_EXPORTS, 'typescript.md'),
      `# TypeScript Guide\n\n**Space:** Dev\n\n**ID:** ts-123\n\nTypeScript adds static typing to JavaScript for safer code.`
    )

    await store.rebuildFromExports()

    const searchResult = await store.search('TypeScript static typing', 5)

    expect(searchResult.ok).toBe(true)
    const results = searchResult.value
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('meta')
    expect(results[0]).toHaveProperty('score')
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('should handle empty exports directory gracefully', async () => {
    const store = new VectorStore(mockConfig)
    await expect(store.rebuildFromExports()).resolves.not.toThrow()
  })
})
