import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkerPool } from '../../src/scraper/worker-pool.js'
import { CheckpointManager } from '../../src/scraper/checkpoint-manager.js'
import { FileWriter } from '../../src/export/file-writer.js'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import type { Browser } from 'patchright'

vi.mock('../../src/scraper/checkpoint-manager.js')
vi.mock('../../src/export/file-writer.js')
vi.mock('../../src/scraper/conversation-extractor.js', () => {
  return {
    ConversationExtractor: vi.fn().mockImplementation(function () {
      return {
        extract: vi.fn(),
        recoverTimeout: vi.fn(),
        reduceTimeout: vi.fn(),
      }
    }),
  }
})

describe('WorkerPool Skip Logic (Unit)', () => {
  let pool: WorkerPool
  let mockConfig: any
  let mockCheckpoint: any
  let mockBrowser: any

  beforeEach(() => {
    mockConfig = { parallelWorkers: 1, authStoragePath: 'path' }
    mockCheckpoint = new CheckpointManager(mockConfig) as any
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue({ close: vi.fn() }),
    } as unknown as Browser
    pool = new WorkerPool(mockConfig, mockCheckpoint, mockBrowser)
    vi.clearAllMocks()
  })

  it('should skip file write if hash matches', async () => {
    await pool.initialize()
    const worker = (pool as any).activeWorkers[0]
    worker.conversationExtractor.extract = vi.fn().mockResolvedValue({
      conversationId: 'thread-1',
      conversationTitle: 'Title',
      contentIntegrityHash: 'hash-abc',
    })

    mockCheckpoint.getContentHash.mockReturnValue('hash-abc')
    mockCheckpoint.getProcessingProgress.mockReturnValue({ processed: 1, total: 1 })

    await (pool as any).performConversationExtraction(worker, {
      conversationMetadata: { id: 'thread-1', url: 'url' },
      currentAttemptCount: 0,
    })

    expect(FileWriter.prototype.write).not.toHaveBeenCalled()
    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1')
  })

  it('should perform file write if hash differs', async () => {
    await pool.initialize()
    const worker = (pool as any).activeWorkers[0]
    worker.conversationExtractor.extract = vi.fn().mockResolvedValue({
      conversationId: 'thread-1',
      conversationTitle: 'Title',
      contentIntegrityHash: 'hash-new',
    })

    mockCheckpoint.getContentHash.mockReturnValue('hash-old')
    mockCheckpoint.getProcessingProgress.mockReturnValue({ processed: 1, total: 1 })

    await (pool as any).performConversationExtraction(worker, {
      conversationMetadata: { id: 'thread-1', url: 'url' },
      currentAttemptCount: 0,
    })

    expect(FileWriter.prototype.write).toHaveBeenCalled()
    expect(mockCheckpoint.markAsProcessed).toHaveBeenCalledWith('thread-1', 'hash-new')
  })
})
