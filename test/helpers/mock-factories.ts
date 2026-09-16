/**
 * Shared mock factories and utilities for tests.
 * Reduces vi.mock duplication and provides explicit dependency injection helpers.
 */

import { vi, type Mock } from 'vitest'
import type { BrowserContext, Page } from '@playwright/test'
import type { Request, Response } from '@playwright/test'
import { ok, err, type Result } from 'super-result'
import type { ExtractedConversation } from '../../src/scraper/conversation-extractor.js'
import type { VectorSearchResult } from '../../src/search/vector-store.js'
import type { ChatMessage } from '../../src/ai/ai-client.js'
import type { LlmResponse } from '../../src/ai/ai-client.js'

/**
 * Creates a mock BrowserContext with common defaults.
 */
export function createMockBrowserContext(
  overrides: Partial<{
    newPage: Mock
    close: Mock
    pages: Mock
  }> = {}
): BrowserContext {
  return {
    newPage: vi.fn().mockResolvedValue(createMockPage()),
    pages: vi.fn().mockReturnValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BrowserContext
}

/**
 * Creates a mock Page with common defaults.
 */
export function createMockPage(
  overrides: Partial<{
    goto: Mock
    waitForLoadState: Mock
    waitForTimeout: Mock
    evaluate: Mock
    waitForResponse: Mock
    close: Mock
  }> = {}
): Page {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({}),
    waitForResponse: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page
}

/**
 * Creates a mock Playwright Request.
 */
export function createMockRequest(
  overrides: Partial<{
    url: Mock
    method: Mock
    headers: Mock
    postData: Mock
  }> = {}
): Request {
  return {
    url: vi.fn().mockReturnValue('http://test.com'),
    method: vi.fn().mockReturnValue('GET'),
    headers: vi.fn().mockReturnValue({}),
    postData: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as Request
}

/**
 * Creates a mock Playwright Response.
 */
export function createMockResponse(
  overrides: Partial<{
    status: Mock
    json: Mock
    text: Mock
    headers: Mock
    request: Mock
    ok: boolean
  }> = {}
): Response {
  return {
    status: vi.fn().mockReturnValue(200),
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
    headers: vi.fn().mockReturnValue({}),
    request: vi.fn().mockReturnValue(createMockRequest()),
    ok: true,
    ...overrides,
  } as unknown as Response
}

/**
 * Creates a mock ConversationExtractor with common defaults.
 */
export function createMockConversationExtractor(
  overrides: {
    extract?: Mock
    recoverTimeout?: Mock
    reduceTimeout?: Mock
    NoDataError?: any
    ExtractionError?: any
  } = {}
) {
  class MockConversationExtractor {
    extract = vi.fn().mockResolvedValue(
      ok({
        id: 'thread-1',
        title: 'Test Title',
        contentHash: 'hash-match',
        spaceName: 'General',
        timestamp: new Date(),
        content: 'Content',
        messages: [],
      })
    )
    recoverTimeout = vi.fn()
    reduceTimeout = vi.fn()
    static NoDataError = class extends Error {
      constructor(m: string) {
        super(m)
        this.name = 'NoDataError'
      }
    }
    static ExtractionError = class extends Error {
      constructor(m: string) {
        super(m)
        this.name = 'ExtractionError'
      }
    }
  }
  const instance = new MockConversationExtractor()
  Object.assign(instance, overrides)
  return instance
}

/**
 * Creates a mock CheckpointManager with common defaults.
 */
export function createMockCheckpointManager(
  overrides: {
    getContentHash?: Mock
    markAsProcessed?: Mock
    getProcessingProgress?: Mock
    setDiscoveredConversations?: Mock
    getPendingConversations?: Mock
  } = {}
) {
  return {
    getContentHash: vi.fn().mockReturnValue('hash-old'),
    markAsProcessed: vi.fn().mockResolvedValue(undefined),
    getProcessingProgress: vi.fn().mockReturnValue({ processed: 0, total: 0 }),
    setDiscoveredConversations: vi.fn().mockResolvedValue(undefined),
    getPendingConversations: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

/**
 * Creates a mock Browser with common defaults.
 */
export function createMockBrowser(
  overrides: {
    newContext?: Mock
    close?: Mock
  } = {}
) {
  return {
    newContext: vi.fn().mockResolvedValue(createMockBrowserContext()),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/**
 * Creates a mock VectorStore with common defaults.
 */
export function createMockVectorStore(
  overrides: {
    search?: Mock
    validate?: Mock
    rebuildFromExports?: Mock
  } = {}
) {
  return {
    search: vi.fn().mockResolvedValue(ok([])),
    validate: vi.fn().mockResolvedValue(undefined),
    rebuildFromExports: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/**
 * Creates a mock OllamaClient with common defaults.
 */
export function createMockOllamaClient(
  overrides: {
    generate?: Mock
    chat?: Mock
    embed?: Mock
    validate?: Mock
  } = {}
) {
  return {
    generate: vi.fn().mockResolvedValue({
      ok: true,
      value: 'Generated response',
    }),
    chat: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: 'Chat response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
    }),
    embed: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    validate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  }
}

/**
 * Creates a mock RagOrchestrator with common defaults.
 */
export function createMockRagOrchestrator(
  overrides: {
    developResearchPlan?: Mock
    executeAdaptiveHybridSearch?: Mock
    extractFactsWithGranularMapReduce?: Mock
    crossEncoderRerank?: Mock
    generateMightiestResponse?: Mock
    answerQuestion?: Mock
    chat?: Mock
  } = {}
) {
  return {
    developResearchPlan: vi.fn().mockResolvedValue({
      strategy: 'precise',
      queries: ['query1'],
      hardKeywords: [],
      hydePassage: '',
    }),
    executeAdaptiveHybridSearch: vi.fn().mockResolvedValue([]),
    extractFactsWithGranularMapReduce: vi.fn().mockResolvedValue([]),
    crossEncoderRerank: vi.fn().mockResolvedValue([]),
    generateMightiestResponse: vi.fn().mockResolvedValue('Answer'),
    answerQuestion: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: 'Response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
    }),
    ...overrides,
  }
}

/**
 * Creates a mock RipgrepSearch with common defaults.
 */
export function createMockRipgrepSearch(
  overrides: {
    search?: Mock
    captureSearchMatches?: Mock
    validateSearchOptions?: Mock
  } = {}
) {
  return {
    search: vi.fn().mockResolvedValue(ok([])),
    captureSearchMatches: vi.fn().mockResolvedValue(ok([])),
    validateSearchOptions: vi.fn().mockReturnValue(ok(undefined)),
    ...overrides,
  }
}

/**
 * Creates a mock logger with common defaults.
 */
export function createMockLogger(
  overrides: {
    info?: Mock
    warn?: Mock
    debug?: Mock
    success?: Mock
    error?: Mock
  } = {}
) {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    ...overrides,
  }
}

/**
 * Creates a mock error bus.
 */
export function createMockErrorBus(
  overrides: {
    emitError?: Mock
    on?: Mock
    off?: Mock
  } = {}
) {
  return {
    emitError: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    ...overrides,
  }
}

/**
 * Creates a mock ExtractedConversation for export tests.
 */
export function createMockExtractedConversation(
  overrides: Partial<{
    id: string
    title: string
    spaceName: string
    timestamp: Date
    content: string
    messages: any[]
    contentHash: string
  }> = {}
): ExtractedConversation {
  return {
    id: 'test-123',
    title: 'Test Conversation',
    spaceName: 'Test Space',
    timestamp: new Date(),
    content: 'Test content',
    messages: [],
    contentHash: 'test-hash',
    ...overrides,
  }
}

/**
 * Creates a mock VectorSearchResult for search tests.
 */
export function createMockVectorSearchResult(
  overrides: Partial<{
    meta: any
    score: number
  }> = {}
): VectorSearchResult {
  return {
    meta: { title: 'Test', id: 'test', snippet: 'test' },
    score: 0.9,
    ...overrides,
  }
}

/**
 * Creates a mock ChatMessage for AI client tests.
 */
export function createMockChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'user',
    content: 'Test message',
    ...overrides,
  }
}

/**
 * Creates a mock LlmResponse for AI client tests.
 */
export function createMockLlmResponse(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return {
    content: 'Test response',
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
    ...overrides,
  }
}

/**
 * Creates a mock fs module for export tests.
 */
export function createMockFs(
  overrides: {
    existsSync?: Mock
    readFileSync?: Mock
    writeFileSync?: Mock
    mkdirSync?: Mock
    readdirSync?: Mock
    appendFile?: Mock
    mkdir?: Mock
    appendFileSync?: Mock
  } = {}
) {
  return {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    appendFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFileSync: vi.fn(),
    ...overrides,
  }
}

/**
 * Creates a mock path module for export tests.
 */
export function createMockPath(
  overrides: {
    join?: Mock
    dirname?: Mock
  } = {}
) {
  return {
    join: vi.fn((...args) => args.join('/')),
    dirname: vi.fn((p) => p.substring(0, p.lastIndexOf('/'))),
    ...overrides,
  }
}

/**
 * Creates a mock Ollama response for generate/chat endpoints.
 */
export function createMockOllamaGenerateResponse(
  overrides: {
    response?: string
    message?: { role: string; content: string }
    choices?: Array<{ message: { role: string; content: string } }>
    done?: boolean
    prompt_eval_count?: number
    eval_count?: number
  } = {}
) {
  return {
    model: 'test-model',
    created_at: new Date().toISOString(),
    response: 'Generated text',
    done: true,
    prompt_eval_count: 10,
    eval_count: 20,
    ...overrides,
  }
}

/**
 * Creates a mock Ollama embeddings response.
 */
export function createMockOllamaEmbedResponse(
  overrides: {
    embeddings?: number[][]
    data?: Array<{ embedding: number[] }>
  } = {}
) {
  return {
    data: [{ embedding: [0.1, 0.2, 0.3] }],
    ...overrides,
  }
}

/**
 * Creates a mock vector store search result.
 */
export function createMockSearchOutcome(
  overrides: Partial<{
    meta: any
    score: number
  }> = {}
) {
  return [
    {
      meta: {
        title: 'Mocked Title',
        path: 'path/to/mocked.md',
        snippet: 'This is some mocked content from a Perplexity export.',
        id: 'mock-1',
      },
      score: 0.95,
      ...overrides,
    },
  ]
}

/**
 * Creates a mock RAG research plan.
 */
export function createMockResearchPlan(
  overrides: {
    strategy?: 'precise' | 'exhaustive'
    queries?: string[]
    hardKeywords?: string[]
    hydePassage?: string
  } = {}
) {
  return {
    strategy: 'precise',
    queries: ['query1'],
    hardKeywords: [],
    hydePassage: '',
    ...overrides,
  }
}

/**
 * Creates a mock verification result.
 */
export function createMockVerificationResult(
  overrides: {
    status?: 'ok' | 'missed-info'
    suggestion?: string
  } = {}
) {
  return {
    status: 'ok',
    suggestion: '',
    ...overrides,
  }
}

/**
 * Creates a mock extracted facts array.
 */
export function createMockExtractedFacts(
  overrides: {
    fact: string
    node_id: number
    thread: string
  }[] = []
) {
  return [
    { fact: 'good from A', node_id: 0, thread: 'Thread A' },
    { fact: 'good from B', node_id: 1, thread: 'Thread B' },
    ...overrides,
  ]
}
