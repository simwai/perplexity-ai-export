import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExportOrchestrator } from '../../src/export/export-orchestrator.js'
import { type Config } from '../../src/utils/config.js'
import { type ExtractedConversation } from '../../src/scraper/conversation-extractor.js'
import * as fs from 'node:fs'

vi.mock('node:fs')
vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path')
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/')),
    dirname: vi.fn((p) => p.substring(0, p.lastIndexOf('/'))),
  }
})

describe('ExportOrchestrator (Unit)', () => {
  const mockConfig: Config = {
    exportDir: 'exports',
    exportStrategies: ['markdown'],
  } as any

  const mockConversation: ExtractedConversation = {
    id: '123',
    title: 'Test Title',
    spaceName: 'Test Space',
    timestamp: new Date(),
    content: 'Content',
    messages: [],
    contentHash: 'hash',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue([] as any)
  })

  it('should initialize and discover strategies', async () => {
    const exportOrchestrator = new ExportOrchestrator(mockConfig)
    await exportOrchestrator.initialize()
    expect(fs.readdirSync).toHaveBeenCalled()
  })
})
