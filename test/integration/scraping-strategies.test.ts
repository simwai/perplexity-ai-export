import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ApiExtractionStrategy,
  DomScrapeExtractionStrategy,
} from '../../src/scraper/extraction-strategy.js'
import type { Page, Response } from 'patchright'

describe('Scraping Strategies Integration', () => {
  let mockPage: any

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      on: vi.fn(),
      evaluate: vi.fn(),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('ApiExtractionStrategy should parse valid thread JSON', async () => {
    const strategy = new ApiExtractionStrategy()
    const mockData = {
      thread_title: 'Test Title',
      entries: [
        {
          query_str: 'Hello',
          blocks: [{ markdown_block: { answer: 'World' } }],
        },
      ],
    }

    // Mock the capture logic
    const capturePromise = (strategy as any).captureConversationApiResponse(mockPage)

    // Simulate the 'response' event
    const responseHandler = mockPage.on.mock.calls.find((call: any) => call[0] === 'response')[1]
    await responseHandler({
      url: () => 'https://www.perplexity.ai/rest/thread/test-slug',
      status: () => 200,
      json: () => Promise.resolve(mockData),
    } as Response)

    const result = await capturePromise
    expect(result.thread_title).toBe('Test Title')

    const parsed = (strategy as any).parseConversationData(
      result,
      'https://www.perplexity.ai/search/test-slug'
    )
    expect(parsed.title).toBe('Test Title')
    expect(parsed.content).toContain('## Hello')
    expect(parsed.content).toContain('World')
  })

  it('DomScrapeExtractionStrategy should extract from mocked DOM', async () => {
    const strategy = new DomScrapeExtractionStrategy()
    mockPage.evaluate.mockResolvedValue({
      id: 'test',
      title: 'DOM Title',
      spaceName: 'General',
      timestamp: new Date(),
      content: 'Scraped Content',
    })

    const result = await strategy.extract(mockPage as Page, 'https://www.perplexity.ai/search/test')
    expect(result?.title).toBe('DOM Title')
    expect(result?.content).toBe('Scraped Content')
  })
})
