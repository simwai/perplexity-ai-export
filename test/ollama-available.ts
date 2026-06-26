import { AiClient } from '../src/ai/ai-client.js'
import { logger } from '../src/utils/logger.js'
import { config } from '../src/utils/config.js'

export async function isOllamaAvailable(): Promise<boolean> {
  const ollama = new AiClient(config)
  try {
    await ollama.validate()
    return true
  } catch (error) {
    logger.warn('⚠ Ollama not available, skipping tests that require it.')
    logger.warn(`   Reason: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
