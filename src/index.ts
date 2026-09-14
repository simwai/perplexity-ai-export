import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'
import { from } from 'super-result'

/**
 * Entry point for the Perplexity History Export application.
 *
 * why: startup is wrapped in `from()` so a failed REPL launch is captured by
 * the global error bus instead of crashing the process silently.
 */
async function bootstrapApplication(): Promise<void> {
  const result = await from(async () => await runInteractiveRepl())
  if (!result.ok) {
    errorBus.emitError('Application failed to start', result.error)
  }
}

async function runInteractiveRepl(): Promise<void> {
  const interactiveRepl = new Repl(config)
  await interactiveRepl.start()
}

bootstrapApplication()
