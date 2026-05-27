import { errorBus } from './utils/error-bus.js'
import { Repl } from './repl/index.js'
import { config } from './utils/config.js'

async function main(): Promise<void> {
  try {
    const repl = new Repl(config)
    await repl.start()
  } catch (error) {
    errorBus.emitError('Failed to start REPL', error)
  }
}

main()
