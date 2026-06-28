import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { config } from '../../src/utils/config.js'

const mswServer = setupServer(
  http.post(`${config.ollamaUrl}/v1/embeddings`, () => {
    return HttpResponse.json({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })
  }),
  http.post(`${config.ollamaUrl}/api/generate`, () => {
    return HttpResponse.json({
      model: config.ollamaModel,
      created_at: new Date().toISOString(),
      response: 'Generated text',
      done: true,
      prompt_eval_count: 10,
      eval_count: 20,
    })
  }),
  http.post(`${config.ollamaUrl}/api/chat`, () => {
    return HttpResponse.json({
      model: config.ollamaModel,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: 'Chat response' },
      done: true,
      prompt_eval_count: 15,
      eval_count: 25,
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => {
  mswServer.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => mswServer.close())

describe('OllamaClient (MSW Mocked)', () => {
  it('should generate text with usage successfully', async () => {
    const client = new OllamaClient(config)
    const response = await client.generateWithUsage('Hello')

    expect(response.content).toBe('Generated text')
    expect(response.usage.promptTokens).toBe(10)
    expect(response.usage.completionTokens).toBe(20)
    expect(response.usage.totalTokens).toBe(30)
  })

  it('should chat successfully', async () => {
    const client = new OllamaClient(config)
    const response = await client.chat([{ role: 'user', content: 'Hello' }])

    expect(response.content).toBe('Chat response')
    expect(response.usage.promptTokens).toBe(15)
    expect(response.usage.completionTokens).toBe(25)
    expect(response.usage.totalTokens).toBe(40)
  })

  it('should throw an error when the server returns a 500 status', async () => {
    mswServer.use(
      http.post(`${config.ollamaUrl}/v1/embeddings`, () => {
        return new HttpResponse(null, { status: 500 })
      })
    )

    const client = new OllamaClient(config)
    await expect(client.embed(['text'])).rejects.toThrow(/Ollama request failed with status 500/)
  })
})
