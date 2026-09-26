import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { ApiDiagnosticsWriter } from '../../src/utils/logging/api-diagnostics.js'
import { NoDataError, ParsingError } from '../../src/scraper/conversation-extractor.js'
import type { BrowserContext, Page } from '@playwright/test'

vi.mock('../../src/utils/api-diagnostics.js', () => {
  return {
    ApiDiagnosticsWriter: vi.fn().mockImplementation(function () {
      return {
        writeFailure: vi.fn().mockResolvedValue(undefined),
      }
    }),
  }
})

vi.mock('../../src/scraper/library-discovery.js', () => {
  return {
    fetchThreadById: vi.fn(),
  }
})

const { fetchThreadById } = await import('../../src/scraper/library-discovery.js')

describe('ConversationExtractor (Unit)', () => {
  let extractor: ConversationExtractor
  let mockContext: BrowserContext
  const mockConfig = {
    waitMode: 'static' as const,
    rateLimitMs: 1000,
    debug: true,
    authStoragePath: '/tmp/auth.json',
    parallelWorkers: 1,
    checkpointSaveInterval: 10,
    exportDir: '/tmp/exports',
    checkpointPath: '/tmp/checkpoint.json',
    vectorIndexPath: '/tmp/vector-index',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama' as const,
    aiEmbedProvider: 'ollama' as const,
    aiBaseUrl: undefined,
    aiApiKey: undefined,
    aiModel: 'llama3.1',
    aiEmbedModel: 'nomic-embed-text',
    enableVectorSearch: false,
    headless: false,
    hydeMode: 'supplement' as const,
    hydeThresholdScore: 0.7,
    hydeThresholdCount: 5,
    exportStrategies: ['markdown'],
    extractionConcurrency: 1,
  }

  beforeEach(() => {
    mockContext = {
      newPage: vi.fn(),
      pages: vi.fn(),
    } as unknown as BrowserContext
    extractor = new ConversationExtractor(mockConfig, mockContext)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should accept config and context', () => {
      expect(extractor).toBeInstanceOf(ConversationExtractor)
    })

    it('should store config with all required fields', () => {
      expect(extractor).toBeDefined()
    })

    it('should store context', () => {
      expect(extractor).toBeDefined()
    })
  })

  describe('extract', () => {
    let mockPage: Page

    beforeEach(() => {
      mockPage = {
        url: vi.fn().mockReturnValue('https://www.perplexity.ai/search/test-thread'),
        goto: vi.fn().mockResolvedValue({ status: () => 200 }),
        waitForResponse: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        isClosed: vi.fn().mockReturnValue(false),
      } as unknown as Page

      // Mock context.pages() to return a page on perplexity.ai
      ;(mockContext.pages as ReturnType<typeof vi.fn>).mockResolvedValue([mockPage])

      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return ParsingError when thread UUID cannot be extracted from URL', async () => {
      const result = await extractor.extract('https://example.com/invalid-url')
      expect(result.ok).toBe(false)
      expect(result.error).toBeInstanceOf(ParsingError)
      expect(result.error.message).toContain('Could not determine thread uuid')
    })

    it('should call fetchThreadById with correct parameters', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: true,
        value: {
          entries: [
            {
              thread_title: 'Test Thread',
              query_str: 'What is TypeScript?',
              blocks: [
                {
                  intended_usage: 'ask_text_0_markdown',
                  markdown_block: { answer: 'TypeScript is a typed superset of JavaScript.' },
                },
              ],
              updated_datetime: '2024-01-15T10:30:00Z',
              collection_info: { title: 'General' },
            },
          ],
          first_entry: null,
          thread_metadata: {},
          status: 'success',
        },
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(fetchThreadById).toHaveBeenCalledWith(
        mockPage,
        'test-thread',
        '2.18',
        expect.objectContaining({ timeoutMs: 30000 })
      )
      expect(result.ok).toBe(true)
      expect(result.value.title).toBe('Test Thread')
      expect(result.value.messages).toHaveLength(2)
      expect(result.value.messages[0]).toEqual({ role: 'user', content: 'What is TypeScript?' })
      expect(result.value.messages[1].content).toContain('TypeScript is a typed superset')
    })

    it('should return NotFoundError when fetchThreadById fails with 404', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: false,
        error: new Error('HTTP 404'),
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(result.ok).toBe(false)
      expect(result.error.message).toContain('Conversation not found (404)')
    })

    it('should return AuthError when fetchThreadById fails with 401/403', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: false,
        error: new Error('HTTP 401 Unauthorized'),
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(result.ok).toBe(false)
      expect(result.error.message).toContain('Authentication required or expired')
    })

    it('should return ServerError when fetchThreadById fails with 5xx', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: false,
        error: new Error('HTTP 500 Internal Server Error'),
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(result.ok).toBe(false)
      expect(result.error.message).toContain('HTTP 500')
    })

    it('should prefer expectedId over extracted UUID', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: true,
        value: {
          entries: [
            {
              thread_title: 'Test',
              query_str: 'Q',
              blocks: [{ intended_usage: 'ask_text_0_markdown', markdown_block: { answer: 'A' } }],
              updated_datetime: '2024-01-15T10:30:00Z',
              collection_info: { title: 'General' },
            },
          ],
          first_entry: null,
          thread_metadata: {},
          status: 'success',
        },
      })

      await extractor.extract('https://www.perplexity.ai/search/wrong-thread', 'correct-thread-id')

      expect(fetchThreadById).toHaveBeenCalledWith(
        mockPage,
        'correct-thread-id',
        '2.18',
        expect.any(Object)
      )
    })

    it('should handle empty entries from fetchThreadById', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: true,
        value: {
          entries: [],
          first_entry: null,
          thread_metadata: {},
          status: 'success',
        },
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(result.ok).toBe(false)
      expect(result.error).toBeInstanceOf(ParsingError)
    })

    it('should deduplicate answers via pickAnswerFromBlocks', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: true,
        value: {
          entries: [
            {
              thread_title: 'Test',
              query_str: 'Q',
              blocks: [
                { intended_usage: 'ask_text', markdown_block: { answer: 'Chunked answer part 1' } },
                {
                  intended_usage: 'ask_text_0_markdown',
                  markdown_block: { answer: 'Full answer from ask_text_0_markdown' },
                },
              ],
              updated_datetime: '2024-01-15T10:30:00Z',
              collection_info: { title: 'General' },
            },
          ],
          first_entry: null,
          thread_metadata: {},
          status: 'success',
        },
      })

      const result = await extractor.extract('https://www.perplexity.ai/search/test-thread')

      expect(result.ok).toBe(true)
      expect(result.value.messages[1].content).toBe('Full answer from ask_text_0_markdown')
    })

    it('should extract ID from URL when expectedId not provided', async () => {
      vi.mocked(fetchThreadById).mockResolvedValue({
        ok: true,
        value: {
          entries: [
            {
              thread_title: 'Test',
              query_str: 'Q',
              blocks: [{ intended_usage: 'ask_text_0_markdown', markdown_block: { answer: 'A' } }],
              updated_datetime: '2024-01-15T10:30:00Z',
              collection_info: { title: 'General' },
            },
          ],
          first_entry: null,
          thread_metadata: {},
          status: 'success',
        },
      })

      await extractor.extract('https://www.perplexity.ai/search/abc123-def456')

      expect(fetchThreadById).toHaveBeenCalledWith(
        mockPage,
        'abc123-def456',
        '2.18',
        expect.any(Object)
      )
    })
  })

  describe('reduceTimeout / recoverTimeout', () => {
    it('should reduce timeout down to minimum', () => {
      // TIMEOUT_MAX_MS = 30000, TIMEOUT_MIN_MS = 8000, STEP_DOWN = 3000
      for (let i = 0; i < 10; i++) {
        extractor.reduceTimeout()
      }
      // After many reductions, should hit minimum
      expect((extractor as unknown as { currentTimeoutMs: number }).currentTimeoutMs).toBe(8000)
    })

    it('should recover timeout up to maximum', () => {
      // First reduce to minimum (30000 - 10*3000 = 0 -> clamped to 8000)
      for (let i = 0; i < 10; i++) {
        extractor.reduceTimeout()
      }
      expect((extractor as unknown as { currentTimeoutMs: number }).currentTimeoutMs).toBe(8000)
      // Then recover to maximum (8000 + 22*1000 = 30000)
      for (let i = 0; i < 22; i++) {
        extractor.recoverTimeout()
      }
      expect((extractor as unknown as { currentTimeoutMs: number }).currentTimeoutMs).toBe(30000)
    })
  })
})
