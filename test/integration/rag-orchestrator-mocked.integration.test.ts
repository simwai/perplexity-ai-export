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
    if (body.prompt.includes('Analyze the user request')) {
      return HttpResponse.json({
        model: 'deepseek-r1',
        response:
          '{"strategy": "precise", "queries": ["What is in my history?"], "keywords": ["mocked"], "filters": {}}',
      })
    }
    if (body.prompt.includes('Verify the answer')) {
      return HttpResponse.json({
        model: 'deepseek-r1',
        response: '[{"fact": "Found mocked title", "source_title": "Mocked Title"}]',
      })
    }

    return HttpResponse.json({
      ...baseResponse,
      response: '{"status": "ok"}'
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
