import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { isOllamaAvailable } from '../ollama-available.js'

const TEST_EXPORTS = join(process.cwd(), 'test-fixtures', 'exports')
const TEST_INDEX = join(process.cwd(), 'test-fixtures', 'vector-index')

// Import and patch config before loading VectorStore
let VectorStore: any

describe.runIf(await isOllamaAvailable())('VectorStore Integration', () => {
  beforeAll(async () => {
    // Setup test directories
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
      mkdirSync(dir, { recursive: true })
    })

    // Dynamically import and patch
    process.env.EXPORT_DIR = TEST_EXPORTS
    process.env.VECTOR_INDEX_PATH = TEST_INDEX

    const configModule = await import('../../src/utils/config.js')
    // Override config properties
    Object.defineProperty(configModule.config, 'exportDir', {
      get: () => TEST_EXPORTS,
      configurable: true,
    })
    Object.defineProperty(configModule.config, 'vectorIndexPath', {
      get: () => TEST_INDEX,
      configurable: true,
    })

    const vectorStoreModule = await import('../../src/search/vector-store.js')
    VectorStore = vectorStoreModule.VectorStore
  })

  afterAll(() => {
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    })
  })

  beforeEach(() => {
    // Clean between tests
    ;[join(TEST_EXPORTS, '*.md'), join(TEST_INDEX, '*')].forEach((pattern) => {
      const dir = pattern.replace('/*', '').replace('/*.md', '')
      if (existsSync(dir)) {
        const files = require('fs').readdirSync(dir)
        for (const file of files) {
          const isFileMdOrJson = file.endsWith('.md') || file.endsWith('.json')
          if (isFileMdOrJson) rmSync(join(dir, file))
        }
      }
    })
  })

  it('should build index from markdown files with real Ollama embeddings', async () => {
    const store = new VectorStore()

    writeFileSync(
      join(TEST_EXPORTS, 'test-conv.md'),
      `# Test Conversation\n\n**Space:** General\n**ID:** test-123\n\n## Question\n\nWhat is testing?\n\n---\n\n## Answer\n\nTesting verifies software behavior.`
    )

    await store.rebuildFromExports()

    expect(existsSync(join(TEST_INDEX, 'index.json'))).toBe(true)

    // Verify index has content
    const indexContent = readFileSync(join(TEST_INDEX, 'index.json'), 'utf-8')
    expect(indexContent.length).toBeGreaterThan(100)
  }, 30000)

  it('should chunk large files automatically during indexing', async () => {
    const store = new VectorStore()

    const largeContent = `# Large File\n\n**Space:** Test\n**ID:** large-1\n\n${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(100)}`
    writeFileSync(join(TEST_EXPORTS, 'large.md'), largeContent)

    await store.rebuildFromExports()

    expect(existsSync(join(TEST_INDEX, 'index.json'))).toBe(true)
  }, 30000)

  it('should search and return relevant results with scores', async () => {
    const store = new VectorStore()

    writeFileSync(
      join(TEST_EXPORTS, 'typescript.md'),
      `# TypeScript Guide\n\n**Space:** Dev\n**ID:** ts-123\n\nTypeScript adds static typing to JavaScript for safer code.`
    )

    await store.rebuildFromExports()

    const results = await store.search('TypeScript static typing', 5)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('meta')
    expect(results[0]).toHaveProperty('score')
    expect(results[0]!.score).toBeGreaterThan(0)
  }, 30000)

  it('should handle empty exports directory gracefully', async () => {
    const store = new VectorStore()
    await expect(store.rebuildFromExports()).resolves.not.toThrow()
  })
})
