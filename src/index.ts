import { Repl } from './repl/index.js'
import { logger } from './utils/logger.js'

async function main(): Promise<void> {
  try {
    const repl = new Repl()
    await repl.start()
  } catch (error) {
    logger.error('Failed to start REPL:')
    if (error instanceof Error) {
      logger.error(error.message)
    }
    process.exit(1)
  }
}

main()
