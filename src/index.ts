import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config as applicationConfiguration } from './utils/config.js'

async function bootstrapApplicationEntryPoint(): Promise<void> {
  try {
    const interactiveApplicationRepl = new Repl(applicationConfiguration)
    await interactiveApplicationRepl.start()
  } catch (initializationError) {
    errorBus.emitError('Application failed to start', initializationError)
    process.exit(1)
  }
}

bootstrapApplicationEntryPoint()
