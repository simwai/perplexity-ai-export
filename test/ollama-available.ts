import { OllamaClient } from '../src/ai/ollama-client.js'
import { logger } from '../src/utils/logger.js'

export async function isOllamaAvailable(): Promise<boolean> {
  const ollama = new OllamaClient()
  try {
    await ollama.validate()
    return true
  } catch (error) {
    logger.warn('⚠ Ollama not available, skipping tests that require it.')
    logger.warn(
      `   Reason: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}
