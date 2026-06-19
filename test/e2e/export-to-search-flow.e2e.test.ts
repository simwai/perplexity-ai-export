import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ExportHandler } from '../../src/repl/handlers/export.js'
import { SearchOrchestrator } from '../../src/search/search-orchestrator.js'
import { CheckpointManager } from '../../src/scraper/checkpoint-manager.js'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { chromium, type Browser } from 'patchright'
import { type Config } from '../../src/utils/config.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { BrowserManager } from '../../src/scraper/browser.js'
import { WorkerPool } from '../../src/scraper/worker-pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_STORAGE_DIR = join(__dirname, '../../.test-storage-e2e')

const mockApplicationConfig: Config = {
  authStoragePath: join(TEST_STORAGE_DIR, 'auth.json'),
  waitMode: 'static',
  rateLimitMs: 1,
  parallelWorkers: 1,
  checkpointSaveInterval: 1,
  exportDir: join(TEST_STORAGE_DIR, 'exports'),
  checkpointPath: join(TEST_STORAGE_DIR, 'checkpoint.json'),
  vectorIndexPath: join(TEST_STORAGE_DIR, 'vector-index'),
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  ollamaEmbedModel: 'nomic-embed-text',
  enableVectorSearch: true,
  headless: true,
  debug: false,
}

describe('Export to Search E2E Flow', () => {
  let browser: Browser

  beforeAll(async () => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_STORAGE_DIR, { recursive: true })
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('should complete the full flow from export to semantic search', async () => {
    const browserContext = await browser.newContext()

    await browserContext.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'user-1' } }),
      })
    })
    await browserContext.route('**/settings', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Settings</html>' })
    })
    await browserContext.route('**/rest/thread/list_ask_threads**', async (route) => {
      const mockedThreads = [
        {
          uuid: 'refactor-tips',
          slug: 'refactor-tips',
          title: 'Refactoring Tips',
          total_threads: 1,
        },
      ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedThreads),
      })
    })
    await browserContext.route('**/rest/userinfo', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })
    await browserContext.route('**/search/refactor-tips', async (route) => {
      const html = `<html><body><script>fetch('/rest/thread/refactor-tips')</script></body></html>`
      await route.fulfill({ status: 200, contentType: 'text/html', body: html })
    })
    await browserContext.route('**/rest/thread/refactor-tips', async (route) => {
      const threadData = {
        entries: [
          {
            thread_title: 'Refactoring Tips',
            query_str: 'How to refactor?',
            blocks: [{ markdown_block: { answer: 'Small commits.' } }],
            updated_datetime: new Date().toISOString(),
          },
        ],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(threadData),
      })
    })

    const checkpointManager = new CheckpointManager(mockApplicationConfig)
    const searchOrchestrator = new SearchOrchestrator(mockApplicationConfig)
    const exportHandler = new ExportHandler(
      mockApplicationConfig,
      checkpointManager,
      searchOrchestrator
    )

    vi.spyOn(BrowserManager.prototype, 'launch').mockResolvedValue(await browserContext.newPage())
    vi.spyOn(BrowserManager.prototype, 'close').mockResolvedValue(undefined)

    vi.spyOn(WorkerPool.prototype, 'initialize').mockImplementation(async function (this: any) {
      ;(this as any).sharedBrowserContext = browserContext
      for (let i = 0; i < (this as any).applicationConfig.parallelWorkers; i++) {
        ;(this as any).activeWorkers.push({
          workerId: i,
          conversationExtractor: new (
            await import('../../src/scraper/conversation-extractor.js')
          ).ConversationExtractor((this as any).applicationConfig, browserContext),
          isCurrentlyBusy: false,
        })
      }
    })

    await exportHandler.handleStartLibraryExport()

    const exportFile = join(
      mockApplicationConfig.exportDir,
      'General',
      'Refactoring_Tips (refactor-tips).md'
    )
    expect(existsSync(exportFile)).toBe(true)

    vi.spyOn(OllamaClient.prototype, 'embed').mockImplementation(async (texts: string[]) => {
      return texts.map(() => [1, 0, 0])
    })
    vi.spyOn(OllamaClient.prototype, 'validate').mockResolvedValue(undefined)

    await searchOrchestrator.vectorizeNow()

    const searchResults = await (searchOrchestrator as any).vectorStore.search('refactor')
    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0].meta.title).toContain('Refactoring Tips')

    await browserContext.close()
  }, 60000)
})
