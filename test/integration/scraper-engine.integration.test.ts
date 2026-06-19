import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext } from 'patchright'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { type Config } from '../../src/utils/config.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_STORAGE_DIR = join(__dirname, '../../.test-storage-scraper')

const mockApplicationConfig: Config = {
  authStoragePath: join(TEST_STORAGE_DIR, 'auth.json'),
  waitMode: 'static',
  rateLimitMs: 10,
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

describe('Scraper Engine Integration', () => {
  let browser: Browser
  let browserContext: BrowserContext

  beforeAll(async () => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true, force: true })
    }
  })

  it('should successfully extract and format a conversation using mocked network responses', async () => {
    browserContext = await browser.newContext()

    // Mock the main page navigation.
    // IMPORTANT: It must trigger a fetch to the thread API to simulate real site behavior.
    await browserContext.route('**/search/**', async (route) => {
      const htmlContent = `
        <html>
          <body>
            <script>
              // Simulate the site fetching its own data
              fetch('/rest/thread/the-great-refactor-123');
            </script>
          </body>
        </html>
      `
      await route.fulfill({ status: 200, contentType: 'text/html', body: htmlContent })
    })

    // Intercept Perplexity API calls to return realistic mocked data
    await browserContext.route('**/rest/thread/**', async (route) => {
      const url = route.request().url()
      if (url.includes('list_')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
        return
      }

      const mockedPerplexityThreadResponse = {
        entries: [
          {
            uuid: 'entry-1',
            thread_title: 'The Great Refactor',
            query_str: 'How do I refactor a God Object?',
            blocks: [
              {
                markdown_block: {
                  answer:
                    'Break it down into smaller, specialized services with single responsibilities.',
                },
              },
            ],
            updated_datetime: '2026-06-01T12:00:00.000Z',
            collection_info: { title: 'Coding Best Practices' },
          },
        ],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedPerplexityThreadResponse),
      })
    })

    // Mock settings page to avoid real navigation failures
    await browserContext.route('**/settings', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Settings</html>' })
    })

    const conversationExtractor = new ConversationExtractor(mockApplicationConfig, browserContext)
    const testConversationUrl = 'https://www.perplexity.ai/search/the-great-refactor-123'

    const extractionResult = await conversationExtractor.extract(testConversationUrl)

    expect(extractionResult.conversationId).toBe('the-great-refactor-123')
    expect(extractionResult.conversationTitle).toBe('The Great Refactor')
    expect(extractionResult.conversationSpaceName).toBe('Coding Best Practices')
    expect(extractionResult.formattedMarkdownContent).toContain('How do I refactor a God Object?')
    expect(extractionResult.formattedMarkdownContent).toContain('Break it down into smaller')
    expect(extractionResult.contentIntegrityHash).toBeDefined()
    expect(extractionResult.contentIntegrityHash.length).toBe(64) // SHA-256 hex length

    await browserContext.close()
  })

  it('should throw an error bus exception for a 404 response', async () => {
    browserContext = await browser.newContext()

    await browserContext.route('**/search/non-existent', async (route) => {
      await route.fulfill({ status: 404 })
    })

    const conversationExtractor = new ConversationExtractor(mockApplicationConfig, browserContext)

    await expect(
      conversationExtractor.extract('https://www.perplexity.ai/search/non-existent')
    ).rejects.toThrow(/404/)

    await browserContext.close()
  })
})
