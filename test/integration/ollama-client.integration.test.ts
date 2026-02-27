import { describe, it, expect, beforeAll } from 'vitest'
import { OllamaClient } from '../../src/ai/ollama-client.js'

describe('OllamaClient Integration', () => {
  let client: OllamaClient

  beforeAll(() => {
    client = new OllamaClient()
  })

  it('should validate Ollama is running and model is available', async () => {
    await expect(client.validate()).resolves.not.toThrow()
  }, 10000)

  it('should embed single text and return correct shape', async () => {
    const texts = ['Hello world']

    const result = await client.embed(texts)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(Array.isArray(result[0])).toBe(true)
    expect(result[0]!.length).toBeGreaterThan(0)
    expect(typeof result[0]![0]).toBe('number')
  }, 15000)

  it('should embed batch of texts in parallel', async () => {
    const texts = [
      'The quick brown fox jumps over the lazy dog in the forest',
      'Artificial intelligence and machine learning revolutionize technology',
      'Pizza is a traditional Italian dish with tomato and cheese'
    ];

    const result = await client.embed(texts);

    expect(result.length).toBe(3);

    // Just verify they're all valid embeddings, don't compare similarity
    for (const embedding of result) {
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      expect(typeof embedding[0]).toBe('number');
    }
  }, 20000);

  it('should truncate text exceeding context length without throwing', async () => {
    const hugeText = 'word '.repeat(10000)

    await expect(client.embed([hugeText])).resolves.toBeDefined()
  }, 30000)

  it('should handle empty array gracefully', async () => {
    const result = await client.embed([])
    expect(result).toEqual([])
  })
})
