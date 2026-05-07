import { Repl } from './repl/index.js'
import { errorBus } from './utils/error-bus.js'

async function main(): Promise<void> {
  try {
    const repl = new Repl()
    await repl.start()
  } catch (error) {
    errorBus.report(error, { message: 'Failed to start REPL' })
  }
}

main()
