import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { RipgrepSearch } from '../../src/search/rg-search.js'
import { logger } from '../../src/utils/logger.js'
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

describe('RagOrchestrator (Mocked AiClient)', () => {
  const mockGenerate = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGenerate.mockReset()

    vi.spyOn(AiClient.prototype, 'generate').mockImplementation(mockGenerate)
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(ok(mockSearchOutcome))
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(ok(undefined))
    vi.spyOn(RipgrepSearch.prototype, 'captureSearchMatches').mockResolvedValue(ok([]))
  })

  it('should orchestrate the RAG flow successfully', async () => {
    mockGenerate
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

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    const ragOrchestratorInstance = new RagOrchestrator(mockConfig)

    try {
      await ragOrchestratorInstance.answerQuestion('What is in my history?')

      const infoCalls = infoSpy.mock.calls.flat().join(' ')
      expect(infoCalls).toContain('Based on your history')
      expect(infoCalls).toContain('Mocked Title')
    } finally {
      infoSpy.mockRestore()
    }
  })
})
