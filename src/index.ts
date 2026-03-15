import { Repl } from './repl/index.js'
import { logger } from './utils/logger.js'
import { ensureSystemRequirements } from './utils/system-check.js'
import { OllamaClient } from './ai/ollama-client.js'

async function main(): Promise<void> {
  try {
    // 1. System Check
    ensureSystemRequirements()

    // 2. AI Model Check & Pull
    const ollama = new OllamaClient()
    await ollama.ensureModelsAreReady()

    // 3. Start REPL
    const repl = new Repl()
    await repl.start()
  } catch (error) {
    logger.error('Application failed to start:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
