import { Repl } from './repl/index.js'
import { logger } from './utils/logger.js'
import { config } from './utils/config.js'

async function main(): Promise<void> {
  try {
    const repl = new Repl(config)
    await repl.start()
  } catch (error) {
    logger.error('Failed to start REPL:', error)
  }
}

main()
