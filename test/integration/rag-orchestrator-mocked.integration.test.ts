import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { RipgrepSearch } from '../../src/search/rg-search.js'
import { logger } from '../../src/utils/logger.js'
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

const mswServer = setupServer(
  http.post(`${mockConfig.ollamaUrl}/api/generate`, async ({ request }) => {
    const body = (await request.json()) as { prompt: string }

    let responseText = ''
    if (body.prompt.includes('Analyze:')) {
      responseText =
        '{"strategy": "precise", "queries": ["What is in my history?"], "hardKeywords": ["mocked"], "filters": {}}'
    } else if (body.prompt.includes('You are the Researcher.')) {
      responseText =
        '[{"fact": "Based on your history, there is a Mocked Title.", "node_id": 0, "thread": "Mocked Title"}]'
    } else if (body.prompt.includes('You are the Narrator.')) {
      responseText = 'Based on your history, there is a Mocked Title.'
    } else if (body.prompt.includes('Verify the answer.')) {
      responseText = '{"status": "ok"}'
    } else {
      responseText = '{"status": "ok"}'
    }

    return HttpResponse.json({
      model: mockConfig.ollamaModel,
      created_at: new Date().toISOString(),
      response: responseText,
      done: true,
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => {
  mswServer.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => mswServer.close())

describe('RagOrchestrator (MSW Mocked)', () => {
  it('should orchestrate the RAG flow successfully', async () => {
    // Mock VectorStore.search to return Result with mock data
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(ok(mockSearchOutcome))
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(undefined)
    vi.spyOn(RipgrepSearch.prototype, 'captureSearchMatches').mockResolvedValue([])

    // Spy on logger.info since that's where the final answer is written (with ℹ prefix)
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    const ragOrchestratorInstance = new RagOrchestrator(mockConfig)

    try {
      await ragOrchestratorInstance.answerQuestion('What is in my history?')

      // Check that logger.info was called with the expected content
      const infoCalls = infoSpy.mock.calls.flat().join(' ')
      expect(infoCalls).toContain('Based on your history')
      expect(infoCalls).toContain('Mocked Title')
    } finally {
      infoSpy.mockRestore()
    }
  })
})
