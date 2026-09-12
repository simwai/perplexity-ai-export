import { config } from '../../src/utils/config.js'
import { describe, it, expect } from 'vitest'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { isOllamaAvailable } from '../ollama-available.js'

describe.runIf(await isOllamaAvailable())('OllamaClient Integration', () => {
  it('should validate Ollama is running and model is available', async () => {
    const client = new OllamaClient(config)
    const result = await client.validate()
    expect(result.ok).toBe(true)
  })

  it('should embed single text and return correct shape', async () => {
    const client = new OllamaClient(config)
    const result = await client.embed(['hello'])
    expect(result.ok).toBe(true)
    expect(result.value).toBeInstanceOf(Array)
    expect(result.value[0]).toBeInstanceOf(Array)
    expect(result.value[0].length).toBeGreaterThan(0)
  })

  it('should embed batch of texts in parallel', async () => {
    const client = new OllamaClient(config)
    const texts = ['hello', 'world', 'test']
    const result = await client.embed(texts)
    expect(result.ok).toBe(true)
    expect(result.value).toHaveLength(3)
    result.value.forEach((emb) => expect(emb.length).toBeGreaterThan(0))
  })

  it('should handle empty array gracefully', async () => {
    const client = new OllamaClient(config)
    const result = await client.embed([])
    expect(result.ok).toBe(true)
    expect(result.value).toEqual([])
  })
})
