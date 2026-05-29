import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import type { BrowserContext } from '@playwright/test'

describe('ConversationExtractor Hashing (Unit)', () => {
  let extractor: ConversationExtractor
  let mockContext: BrowserContext
  const mockConfig = {
    waitMode: 'static',
    rateLimitMs: 1000,
    debug: true,
  } as any

  beforeEach(() => {
    mockContext = {} as unknown as BrowserContext
    extractor = new ConversationExtractor(mockConfig, mockContext)
  })

  it('should generate the same hash for identical entries', () => {
    const entries = [{ id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'hi' } }] }]
    const hash1 = (extractor as any).hashEntries(entries)
    const hash2 = (extractor as any).hashEntries(entries)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('should generate different hashes for different entries', () => {
    const entries1 = [
      { id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'hi' } }] },
    ]
    const entries2 = [
      { id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'hello' } }] },
    ]
    const hash1 = (extractor as any).hashEntries(entries1)
    const hash2 = (extractor as any).hashEntries(entries2)
    expect(hash1).not.toBe(hash2)
  })

  it('should be stable regardless of key order in entries', () => {
    const entries1 = [{ a: 1, b: 2 }]
    const entries2 = [{ b: 2, a: 1 }]
    const hash1 = (extractor as any).hashEntries(entries1)
    const hash2 = (extractor as any).hashEntries(entries2)
    expect(hash1).toBe(hash2)
  })
})
