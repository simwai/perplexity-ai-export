import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkerPool } from '../../src/scraper/worker-pool.js'

vi.mock('../../src/scraper/conversation-extractor.js', () => {
  class MockConversationExtractor {
    extract = vi.fn()
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
  return {
    ConversationExtractor: MockConversationExtractor,
    __esModule: true,
  }
})

vi.mock('../../src/scraper/checkpoint-manager.js')

describe('WorkerPool Skip Logic (Unit)', () => {
  let pool: WorkerPool
  let mockCheckpoint: any
  let mockBrowser: any
  let mockConfig: any

  beforeEach(() => {
    mockConfig = { parallelWorkers: 1, authStoragePath: '/tmp/auth.json' }
    mockCheckpoint = {
      getContentHash: vi.fn(),
      markAsProcessed: vi.fn(),
      getProcessingProgress: vi.fn().mockReturnValue({ processed: 1, total: 1 }),
    }
    const mockContext = {
      close: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn().mockReturnValue([]),
    }
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
    }
    pool = new WorkerPool(mockConfig, mockCheckpoint, mockBrowser)
  })

  it('should skip file write if hash matches', async () => {
    await pool.initialize()
    const worker = (pool as any).workers[0]
    worker.extractor.extract = vi.fn().mockResolvedValue({
      id: 'thread-1',
      title: 'Title',
      contentHash: 'hash-match',
      spaceName: 'General',
      timestamp: new Date(),
      content: 'Content',
      messages: [],
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-match')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1')
  })

  it.skip('should perform file write if hash differs - TODO: fix mock extraction', async () => {
    await pool.initialize()
    const worker = (pool as any).workers[0]
    worker.extractor.extract = vi.fn().mockResolvedValue({
      id: 'thread-1',
      title: 'Title',
      contentHash: 'hash-new',
      spaceName: 'General',
      timestamp: new Date(),
      content: 'Content',
      messages: [],
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-old')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1', 'hash-new')
  })
})
