import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { ApiDiagnosticsWriter } from '../../src/utils/api-diagnostics.js'
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
    waitMode: 'static',
    rateLimitMs: 1000,
    debug: true,
    authStoragePath: '/tmp/auth.json',
    waitMode: 'static' as const,
    rateLimitMs: 1000,
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
    debug: true,
    hydeMode: 'supplement' as const,
    hydeThresholdScore: 0.7,
    hydeThresholdCount: 5,
    exportStrategies: ['markdown'],
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
      expect(extractor.config).toBeDefined()
      expect(extractor.config.authStoragePath).toBe('/tmp/auth.json')
      expect(extractor.config.rateLimitMs).toBe(1000)
      expect(extractor.config.debug).toBe(true)
    })

    it('should store context', () => {
      expect(extractor.context).toBe(mockContext)
    })
  })
})
