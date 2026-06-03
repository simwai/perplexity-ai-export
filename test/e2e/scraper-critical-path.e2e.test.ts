import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext } from 'patchright'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { config as applicationConfiguration } from '../../src/utils/config.js'
import { existsSync, rmSync } from 'node:fs'

const TEST_OUTPUT_DIRECTORY = './test-output-e2e'

describe('Scraper E2E - Critical Path', () => {
  let browserInstance: Browser
  let browserContext: BrowserContext

  beforeAll(async () => {
    browserInstance = await chromium.launch({ headless: true })
    if (existsSync(TEST_OUTPUT_DIRECTORY)) {
      rmSync(TEST_OUTPUT_DIRECTORY, { recursive: true })
    }
  })

  afterAll(async () => {
    await browserInstance?.close()
    if (existsSync(TEST_OUTPUT_DIRECTORY)) {
      rmSync(TEST_OUTPUT_DIRECTORY, { recursive: true })
    }
  })

  it('should handle missing/invalid URL gracefully by raising a descriptive error', async () => {
    browserContext = await browserInstance.newContext()
    const conversationExtractor = new ConversationExtractor(applicationConfiguration, browserContext)

    // We expect the extraction to fail with an authentication or status error for a nonexistent thread
    await expect(
      conversationExtractor.extract('https://www.perplexity.ai/search/nonexistent-xyz-12345')
    ).rejects.toThrow(/Auth required or expired|Authentication required|403|401|No API response/)

    await browserContext.close()
  }, 30000)
})
