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
    if (body.prompt.includes('Analyze:')) {
      responseText = '{"strategy": "precise", "queries": ["What is in my history?"], "hardKeywords": ["mocked"], "filters": {}}'
    } else if (body.prompt.includes('You are the Researcher.')) {
      responseText = '[{"fact": "Based on your history, there is a Mocked Title.", "node_id": 0, "thread": "Mocked Title"}]'
    } else if (body.prompt.includes('You are the Narrator.')) {
      responseText = 'Based on your history, there is a Mocked Title.'
    } else if (body.prompt.includes('Verify the answer.')) {
      responseText = '{"status": "ok"}'
    } else {
      responseText = '{"status": "ok"}'
    }

    return HttpResponse.json({
      model: 'deepseek-r1',
      created_at: new Date().toISOString(),
      response: responseText,
      done: true
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
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(mockSearchOutcome)
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(undefined)
    vi.spyOn(RgSearch.prototype, 'captureSearchMatches').mockResolvedValue([])

    const ragOrchestratorInstance = new RagOrchestrator()
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await ragOrchestratorInstance.answerQuestion('What is in my history?')

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Based on your history'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Mocked Title'))

    consoleLogSpy.mockRestore()
  })
})
