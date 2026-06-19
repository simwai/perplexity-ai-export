import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { config } from '../../src/utils/config.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { RgSearch } from '../../src/search/rg-search.js'

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
  http.post(`${config.ollamaUrl}/api/generate`, async ({ request }) => {
    const body = (await request.json()) as { prompt: string }

    let responseText = ''
    if (body.prompt.includes('Standalone Question:')) {
      responseText = 'What is in my history?'
    } else if (body.prompt.includes('Analyze:')) {
      responseText =
        '{"strategy": "precise", "queries": ["What is in my history?"], "hardKeywords": ["mocked"], "filters": {}}'
    } else if (body.prompt.includes('You are the Researcher.')) {
      responseText =
        '[{"fact": "Based on your history, there is a Mocked Title.", "node_id": 0, "thread": "Mocked Title"}]'
    } else {
      responseText = 'ok'
    }

    return HttpResponse.json({
      model: config.ollamaModel,
      created_at: new Date().toISOString(),
      response: responseText,
      done: true,
    })
  }),
  http.post(`${config.ollamaUrl}/api/chat`, async () => {
    return HttpResponse.json({
      model: config.ollamaModel,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: 'History-based chat response' },
      done: true,
      prompt_eval_count: 100,
      eval_count: 50,
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => {
  mswServer.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => mswServer.close())

describe('RagOrchestrator Chat (MSW Mocked)', () => {
  it('should process a chat turn successfully', async () => {
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(mockSearchOutcome)
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(undefined)
    vi.spyOn(RgSearch.prototype, 'captureSearchMatches').mockResolvedValue([])

    const ragOrchestratorInstance = new RagOrchestrator(config)
    const response = await ragOrchestratorInstance.chat('Tell me more', [{ role: 'user', content: 'What is this?' }])

    expect(response.content).toBe('History-based chat response')
    expect(response.usage.totalTokens).toBe(150)
  })
})
