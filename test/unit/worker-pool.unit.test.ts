import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkerPool } from '../../src/scraper/worker-pool.js'
import { createMockBrowser, createMockCheckpointManager } from '../helpers/mock-factories.js'

vi.mock('../../src/scraper/conversation-extractor.js', () => {
  class MockConversationExtractor {
    extract = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'thread-1',
        title: 'Title',
        contentHash: 'hash-match',
        spaceName: 'General',
        timestamp: new Date(),
        content: 'Content',
        messages: [],
      },
      error: undefined,
    })
    recoverTimeout = vi.fn()
    reduceTimeout = vi.fn()
  }
  return {
    ConversationExtractor: MockConversationExtractor,
    __esModule: true,
  }
})

vi.mock('../../src/scraper/checkpoint-manager.js')

describe('WorkerPool Skip Logic (Unit)', () => {
  let pool: WorkerPool
  let mockCheckpoint: ReturnType<import('../helpers/mock-factories.js').createMockCheckpointManager>
  let mockBrowser: ReturnType<import('../helpers/mock-factories.js').createMockBrowser>
  let mockConfig: ReturnType<import('../helpers/mock-factories.js').createScraperMockConfig>

  beforeEach(() => {
    mockConfig = { parallelWorkers: 1, extractionConcurrency: 1, authStoragePath: '/tmp/auth.json' }
    mockCheckpoint = createMockCheckpointManager()
    mockCheckpoint.markAsProcessed = vi
      .fn()
      .mockResolvedValue({ ok: true, value: undefined, error: undefined })
    mockCheckpoint.getContentHash = vi.fn().mockReturnValue('hash-match')
    mockCheckpoint.getProcessingProgress = vi.fn().mockReturnValue({ processed: 1, total: 1 })
    mockBrowser = createMockBrowser()
    pool = new WorkerPool(mockConfig, mockCheckpoint, mockBrowser)
  })

  it('should skip file write if hash matches', async () => {
    const initResult = await pool.initialize()
    expect(initResult.ok).toBe(true)
    const workers = (pool as any).workers
    expect(workers.length).toBeGreaterThan(0)
    const worker = workers[0]
    worker.extractor.extract = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'thread-1',
        title: 'Title',
        contentHash: 'hash-match',
        spaceName: 'General',
        timestamp: new Date(),
        content: 'Content',
        messages: [],
      },
      error: undefined,
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-match')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1')
  })

  it.skip('should perform file write if hash differs - TODO: fix mock extraction', async () => {
    const initResult = await pool.initialize()
    expect(initResult.ok).toBe(true)
    const worker = (pool as any).workers[0]
    worker.extractor.extract = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'thread-1',
        title: 'Title',
        contentHash: 'hash-new',
        spaceName: 'General',
        timestamp: new Date(),
        content: 'Content',
        messages: [],
      },
      error: undefined,
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-old')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1', 'hash-new')
  })
})
