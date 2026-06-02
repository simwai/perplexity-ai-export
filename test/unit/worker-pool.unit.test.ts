import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkerPool } from '../../src/scraper/worker-pool.js'

vi.mock('../../src/scraper/conversation-extractor.js')
vi.mock('../../src/scraper/checkpoint-manager.js')
vi.mock('../../src/export/file-writer.js')

describe('WorkerPool Skip Logic (Unit)', () => {
  let pool: WorkerPool
  let mockCheckpoint: any
  let mockBrowser: any
  let mockConfig: any

  beforeEach(() => {
    mockConfig = { parallelWorkers: 1 }
    mockCheckpoint = {
      getContentHash: vi.fn(),
      markAsProcessed: vi.fn(),
      getProcessingProgress: vi.fn().mockReturnValue({ processed: 1, total: 1 }),
    }
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
      }),
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
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-match')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect((pool as any).fileWriter.write).not.toHaveBeenCalled()
    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1')
  })

  it('should perform file write if hash differs', async () => {
    await pool.initialize()
    const worker = (pool as any).workers[0]
    worker.extractor.extract = vi.fn().mockResolvedValue({
      id: 'thread-1',
      title: 'Title',
      contentHash: 'hash-new',
    })
    mockCheckpoint.getContentHash.mockReturnValue('hash-old')

    await pool.processConversations([{ id: 'thread-1', url: 'http://url' }])

    expect((pool as any).fileWriter.write).toHaveBeenCalled()
    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1', 'hash-new')
  })
})
