import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileWriter } from '../../src/export/file-writer.js'
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

describe('FileWriter (Unit)', () => {
  const mockConfig: Config = {
    exportDir: 'exports',
    enabledExporters: ['markdown'],
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

  it('should initialize and discover exporters', async () => {
    const fileWriter = new FileWriter(mockConfig)
    await fileWriter.initialize()
    expect(fs.readdirSync).toHaveBeenCalled()
  })
})
