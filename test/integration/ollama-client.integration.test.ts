import { describe, it, expect } from 'vitest'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { isOllamaAvailable } from '../ollama-available.js'

describe.runIf(await isOllamaAvailable())('OllamaClient Integration', () => {
  it('should validate Ollama is running and model is available', async () => {
    const client = new OllamaClient()
    await expect(client.validate()).resolves.not.toThrow()
  })

  it('should embed single text and return correct shape', async () => {
    const client = new OllamaClient()
    const result = await client.embed(['hello'])
    expect(result).toBeInstanceOf(Array)
    expect(result[0]).toBeInstanceOf(Array)
    expect(result[0].length).toBeGreaterThan(0)
  })

  it('should embed batch of texts in parallel', async () => {
    const client = new OllamaClient()
    const texts = ['hello', 'world', 'test']
    const result = await client.embed(texts)
    expect(result).toHaveLength(3)
    result.forEach((emb) => expect(emb.length).toBeGreaterThan(0))
  })

  it('should handle empty array gracefully', async () => {
    const client = new OllamaClient()
    const result = await client.embed([])
    expect(result).toEqual([])
  })
})
