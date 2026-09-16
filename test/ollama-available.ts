import { OllamaClient } from '../src/ai/ollama-client.js'
import { logger } from '../src/utils/logger.js'

const mockConfig = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  ollamaEmbedModel: 'nomic-embed-text',
  aiProvider: 'ollama' as const,
  aiEmbedProvider: 'ollama' as const,
  debug: false,
  authStoragePath: '/tmp/auth.json',
  checkpointPath: '/tmp/checkpoint.json',
  waitMode: 'dynamic' as const,
  rateLimitMs: 500,
  parallelWorkers: 5,
  extractionConcurrency: 2,
  checkpointSaveInterval: 10,
  exportDir: '/tmp/exports',
  vectorIndexPath: '/tmp/vector-index',
  aiBaseUrl: undefined,
  aiApiKey: undefined,
  aiModel: undefined,
  aiEmbedModel: undefined,
  enableVectorSearch: undefined,
  headless: false,
  hydeMode: 'supplement' as const,
  hydeThresholdScore: 0.7,
  hydeThresholdCount: 5,
  exportStrategies: ['markdown'],
}

export async function isOllamaAvailable(): Promise<boolean> {
  const ollama = new OllamaClient(mockConfig)
  try {
    await ollama.validate()
    return true
  } catch (error) {
    logger.warn('⚠ Ollama not available, skipping tests that require it.')
    logger.warn(`   Reason: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
