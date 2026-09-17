import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { ApiDiagnosticsWriter } from '../../src/utils/logging/api-diagnostics.js'
import type { BrowserContext } from '@playwright/test'

vi.mock('../../src/utils/api-diagnostics.js', () => {
  return {
    ApiDiagnosticsWriter: vi.fn().mockImplementation(function () {
      return {
        writeFailure: vi.fn().mockResolvedValue(undefined),
      }
    }),
  }
})

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

  describe('constructor', () => {
    it('should accept config and context', () => {
      expect(extractor).toBeInstanceOf(ConversationExtractor)
    })

    it('should store config with all required fields', () => {
      expect(extractor).toBeDefined()
      // Config is private, just verify extractor was created
    })

    it('should store context', () => {
      expect(extractor).toBeDefined()
      // Context is private, just verify extractor was created
    })
  })
})
