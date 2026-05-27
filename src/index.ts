import { Repl } from './repl/index.js'
import { errorBus } from './utils/error-bus.js'
import { ErrorMessages } from './utils/error-messages.js'

async function main(): Promise<void> {
  try {
    const repl = new Repl()
    await repl.start()
  } catch (error) {
    errorBus.report(error, { message: ErrorMessages.Repl.StartFailed })
  }
}

main()
