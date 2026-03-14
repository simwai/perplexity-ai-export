import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { config } from '../../src/utils/config.js'

const mockEmbeddingsResponse = [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }]

const mswServer = setupServer(
  http.post(`${config.ollamaUrl}/v1/embeddings`, () => {
    return HttpResponse.json({ data: mockEmbeddingsResponse })
  }),
  http.post(`${config.ollamaUrl}/api/generate`, async ({ request }) => {
    const requestBody = (await request.json()) as { prompt: string }
    return HttpResponse.json({
      model: 'deepseek-r1',
      created_at: new Date().toISOString(),
      response: `Mocked response for prompt: ${requestBody.prompt}`,
      done: true,
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

describe('OllamaClient (MSW Mocked)', () => {
  it('should return embeddings using OpenAI format', async () => {
    const ollamaClientInstance = new OllamaClient()
    const resultVectors = await ollamaClientInstance.embed(['text1', 'text2'])
    expect(resultVectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
  })

  it('should generate a response from a prompt', async () => {
    const ollamaClientInstance = new OllamaClient()
    const generatedText = await ollamaClientInstance.generate('test prompt')
    expect(generatedText).toBe('Mocked response for prompt: test prompt')
  })

  it('should throw an error when the server returns a 500 status', async () => {
    mswServer.use(
      http.post(`${config.ollamaUrl}/v1/embeddings`, () => {
        return new HttpResponse(null, { status: 500 })
      })
    )
    const ollamaClientInstance = new OllamaClient()
    await expect(ollamaClientInstance.embed(['text'])).rejects.toThrow(
      'Ollama request failed with status 500'
    )
  })
})
