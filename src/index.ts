import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'
import { logger } from './utils/logger.js'

async function bootstrapApplication(): Promise<void> {
  try {
    const interactiveRepl = new Repl(config)
    await interactiveRepl.start()
  } catch (err) {
    errorBus.emitError('Application failed to start', err)
    logger.error('Fatal initialization error. Exiting.')
    process.exit(1)
  }
}

bootstrapApplication()
