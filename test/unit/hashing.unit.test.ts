import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import type { BrowserContext } from 'patchright'

describe('ConversationExtractor Hashing (Unit)', () => {
  let extractor: ConversationExtractor
  const mockConfig = {} as any
  const mockContext = {} as any

  beforeEach(() => {
    extractor = new ConversationExtractor(mockConfig, mockContext)
  })

  it('should generate the same hash for identical entries', () => {
    const entries = [{ id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'abc' } }] }]
    const data = { entries }
    const res1 = (extractor as any).dataParser.parse(data, 'http://test.com/search/1')
    const res2 = (extractor as any).dataParser.parse(data, 'http://test.com/search/1')
    expect(res1.hash).toBe(res2.hash)
  })

  it('should generate different hashes for different entries', () => {
    const entries1 = [{ id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'abc' } }] }]
    const entries2 = [{ id: '1', query_str: 'test', blocks: [{ markdown_block: { answer: 'def' } }] }]
    const res1 = (extractor as any).dataParser.parse({ entries: entries1 }, 'http://test.com/search/1')
    const res2 = (extractor as any).dataParser.parse({ entries: entries2 }, 'http://test.com/search/1')
    expect(res1.hash).not.toBe(res2.hash)
  })

  it('should be stable regardless of key order in entries', () => {
    const entries1 = [{ a: 1, b: 2 }]
    const entries2 = [{ b: 2, a: 1 }]
    const data1 = { query_str: 'q', entries: entries1 }
    const data2 = { query_str: 'q', entries: entries2 }
    const res1 = (extractor as any).dataParser.parse(data1, 'http://test.com/search/1')
    const res2 = (extractor as any).dataParser.parse(data2, 'http://test.com/search/1')
    expect(res1.hash).toBe(res2.hash)
  })
})
