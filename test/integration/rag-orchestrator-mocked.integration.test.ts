import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { config } from '../../src/utils/config.js'
import { VectorStore } from '../../src/search/vector-store.js'

const mockSearchOutcome = [
  {
    meta: {
      title: 'Mocked Title',
      path: 'path/to/mocked.md',
      snippet: 'This is some mocked content from a Perplexity export.',
    },
    score: 0.95,
  },
]

const mswServer = setupServer(
  http.post(`${config.ollamaUrl}/api/generate`, async ({ request }) => {
    await request.json()
    return HttpResponse.json({
      model: 'deepseek-r1',
      created_at: new Date().toISOString(),
      response: 'Based on your history, the answer is found in your exports.',
      done: true,
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

describe('RagOrchestrator (MSW Mocked)', () => {
  it('should orchestrate the RAG flow successfully', async () => {
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(mockSearchOutcome)
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(undefined)

    const ragOrchestratorInstance = new RagOrchestrator()
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await ragOrchestratorInstance.answerQuestion('What is in my history?')

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Based on your history'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Mocked Title'))

    consoleLogSpy.mockRestore()
  })
})
