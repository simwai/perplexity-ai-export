import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'
import { logger } from './utils/logger.js'

async function bootstrapApplication(): Promise<void> {
  try {
    logger.debug('Bootstrapping application')
    const interactiveRepl = new Repl(config)
    await interactiveRepl.start()
  } catch (initializationError) {
    errorBus.emitError('Application failed to start', initializationError)
  }
}

bootstrapApplication()
