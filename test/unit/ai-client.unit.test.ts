import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AiClient } from '../../src/ai/ai-client.js'
import { createOllamaClientMockConfig } from '../helpers/test-config.js'

describe('AiClient (Unit)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('generate', () => {
    it('should handle Ollama generate format', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.1',
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            model: 'llama3.1',
            created_at: new Date().toISOString(),
            response: 'Ollama answer',
            done: true,
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const result = await client.generate('Hello Ollama')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe('Ollama answer')
      }
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'llama3.1', prompt: 'Hello Ollama', stream: false }),
        })
      )
    })

    it('should handle OpenAI-compatible chat completions format and headers', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'openai-compatible',
        aiBaseUrl: 'https://integrate.api.nvidia.com/v1',
        aiApiKey: 'test-api-key',
        aiModel: 'meta/llama-3.3-70b-instruct',
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: 'OpenAI-compatible answer' },
              },
            ],
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const result = await client.generate('Hello External AI')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe('OpenAI-compatible answer')
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          },
          body: JSON.stringify({
            model: 'meta/llama-3.3-70b-instruct',
            messages: [{ role: 'user', content: 'Hello External AI' }],
            stream: false,
          }),
        })
      )
    })

    it('should normalize base URLs with trailing slashes or duplicate /v1', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'openai-compatible',
        aiBaseUrl: 'https://integrate.api.nvidia.com/v1/',
        aiApiKey: 'test-key',
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Normalized URL response' } }],
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const result = await client.generate('Test URL')

      expect(result.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        expect.anything()
      )
    })

    it('should return error when external provider is set without AI_BASE_URL', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'openai-compatible',
        aiBaseUrl: undefined,
      })

      const client = new AiClient(mockConfig)
      const result = await client.generate('Test missing base URL')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('AI_BASE_URL is required')
      }
    })
  })

  describe('generateWithUsage', () => {
    it('should parse token usage from OpenAI-compatible response', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'openai-compatible',
        aiBaseUrl: 'https://openrouter.ai/api/v1',
        aiApiKey: 'sk-or-key',
        aiModel: 'anthropic/claude-3-5-sonnet',
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Response with usage' } }],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const result = await client.generateWithUsage('Hello usage')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.content).toBe('Response with usage')
        expect(result.value.usage).toEqual({
          promptTokens: 15,
          completionTokens: 25,
          totalTokens: 40,
        })
      }
    })
  })

  describe('chat', () => {
    it('should pass message history to external provider', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiProvider: 'openai-compatible',
        aiBaseUrl: 'https://api.deepseek.com/v1',
        aiApiKey: 'ds-key',
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'DeepSeek reply' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const messages = [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello!' },
        { role: 'user' as const, content: 'How are you?' },
      ]
      const result = await client.chat(messages)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.content).toBe('DeepSeek reply')
      }
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'llama3.1',
            messages,
            stream: false,
          }),
        })
      )
    })
  })

  describe('embed', () => {
    it('should return empty array when inputTexts is empty', async () => {
      const mockConfig = createOllamaClientMockConfig()
      const client = new AiClient(mockConfig)
      const result = await client.embed([])

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([])
      }
    })

    it('should parse embeddings from OpenAI-compatible format', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiEmbedProvider: 'openai-compatible',
        aiBaseUrl: 'https://api.openai.com/v1',
        aiApiKey: 'openai-key',
        aiEmbedModel: 'text-embedding-3-small',
      })

      const expectedEmbedding = [0.1, 0.2, 0.3]
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ embedding: expectedEmbedding }],
          }),
      } as Response)

      const client = new AiClient(mockConfig)
      const result = await client.embed(['embed text'])

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual([expectedEmbedding])
      }
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer openai-key',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: ['embed text'],
          }),
        })
      )
    })

    it('should fail if external embed provider is set without AI_BASE_URL', async () => {
      const mockConfig = createOllamaClientMockConfig({
        aiEmbedProvider: 'openai-compatible',
        aiBaseUrl: undefined,
      })

      const client = new AiClient(mockConfig)
      const result = await client.embed(['test'])

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('AI_BASE_URL is required')
      }
    })
  })
})
