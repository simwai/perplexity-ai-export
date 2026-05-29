import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'

/**
 * Entry point for the Perplexity History Export application.
 */
async function bootstrapApplication(): Promise<void> {
  try {
    const interactiveRepl = new Repl(config)
    await interactiveRepl.start()
  } catch (initializationError) {
    errorBus.emitError('Application failed to start', initializationError)
  }
}

bootstrapApplication()
