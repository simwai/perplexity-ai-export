import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'
import { from } from 'super-result'

/**
 * Entry point for the Perplexity History Export application.
 */
async function bootstrapApplication(): Promise<void> {
  const result = await from(async () => {
    const interactiveRepl = new Repl(config)
    await interactiveRepl.start()
  })
  if (!result.ok) {
    errorBus.emitError('Application failed to start', result.error)
  }
}

bootstrapApplication()
