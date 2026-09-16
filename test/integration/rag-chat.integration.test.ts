import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { RipgrepSearch } from '../../src/search/rg-search.js'
import { AiClient } from '../../src/ai/ai-client.js'
import { ok } from 'super-result'

const mockConfig = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  ollamaEmbedModel: 'nomic-embed-text',
  aiProvider: 'ollama' as const,
  aiEmbedProvider: 'ollama' as const,
  debug: false,
}

const mockSearchOutcome = [
  {
    meta: {
      title: 'Mocked Title',
      path: 'path/to/mocked.md',
      snippet: 'This is some mocked content from a Perplexity export.',
      id: 'mock-1',
    },
    score: 0.95,
  },
]

describe('RagOrchestrator Chat (Mocked AiClient)', () => {
  const mockGenerate = vi.fn()
  const mockChat = vi.fn()

  const originalGenerate = AiClient.prototype.generate
  const originalChat = AiClient.prototype.chat

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGenerate.mockReset()
    mockChat.mockReset()
    AiClient.prototype.generate = mockGenerate
    AiClient.prototype.chat = mockChat
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(ok(mockSearchOutcome))
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(ok(undefined))
    vi.spyOn(RipgrepSearch.prototype, 'captureSearchMatches').mockResolvedValue(ok([]))
  })

  afterEach(() => {
    AiClient.prototype.generate = originalGenerate
    AiClient.prototype.chat = originalChat
  })

  it('should process a chat turn successfully', async () => {
    mockGenerate
      .mockResolvedValueOnce(ok('What is in my history?'))
      .mockResolvedValueOnce(
        ok(
          '{"strategy": "precise", "queries": ["What is in my history?"], "hardKeywords": ["mocked"]}'
        )
      )
      .mockResolvedValueOnce(
        ok('[{"fact": "Based on your history, there is a Mocked Title.", "node_id": 0}]')
      )
      .mockResolvedValueOnce(ok('[{"index": 0, "relevant": true}]'))
      .mockResolvedValueOnce(ok('Based on your history, there is a Mocked Title.'))
      .mockResolvedValueOnce(ok('{"status": "ok"}'))

    mockChat.mockResolvedValueOnce(
      ok({
        content: 'History-based chat response',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })
    )

    const ragOrchestratorInstance = new RagOrchestrator(mockConfig)
    const response = await ragOrchestratorInstance.chat('Tell me more', [
      { role: 'user', content: 'What is this?' },
    ])

    expect(response.ok).toBe(true)
    expect(response.value.content).toBe('History-based chat response')
    expect(response.value.usage.totalTokens).toBe(150)
  })
})
