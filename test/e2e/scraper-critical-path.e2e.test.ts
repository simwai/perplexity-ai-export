import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { createConfig, initializeConfigDirs } from '../../src/utils/config.js'
import { existsSync, rmSync } from 'node:fs'

const TEST_OUTPUT = './test-output-e2e'

describe('Scraper E2E - Critical Path', () => {
  let browser: Browser
  let context: BrowserContext
  let testConfig: Awaited<ReturnType<typeof createConfig>> extends Result<infer T, Error>
    ? T
    : never

  beforeAll(async () => {
    const configResult = createConfig()
    if (!configResult.ok) throw configResult.error
    testConfig = configResult.value
    initializeConfigDirs(testConfig)

    browser = await chromium.launch({ headless: true })
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true })
  })

  afterAll(async () => {
    await browser?.close()
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true })
  })

  // Skip this - requires real authenticated Perplexity session
  it.skip('should complete full workflow: discover → extract → save', async () => {
    // Manual test only - replace URL with real conversation from your account
  }, 60000)

  it('should handle missing/invalid URL gracefully without crashing', async () => {
    context = await browser.newContext()
    const extractor = new ConversationExtractor(testConfig, context)

    // extract() returns Result; expect it to return an Err for auth failure
    const result = await extractor.extract('https://www.perplexity.ai/search/nonexistent-xyz-12345')
    expect(result.ok).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.message).toMatch(/Authentication required|403|401|No API response/)

    await context.close()
  }, 30000)
})
