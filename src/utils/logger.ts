import chalk from 'chalk'
import { inspect } from 'node:util'
import { errorBus } from './error-bus.js'

export const logger = {
  info(...args: unknown[]): void {
    console.log(chalk.blue('ℹ'), ...args)
  },

  success(...args: unknown[]): void {
    console.log(chalk.green('✓'), ...args)
  },

  warn(...args: unknown[]): void {
    console.log(chalk.yellow('⚠'), ...args)
  },

  error(...args: unknown[]): void {
    const processedArgs = args.map((arg) => {
      if (arg instanceof Error) {
        return inspect(arg, { depth: null, colors: true })
      }
      return arg
    })
    console.error(chalk.red('✗'), ...processedArgs)
  },

  debug(...args: unknown[]): void {
    console.log(chalk.gray('›'), ...args)
  },
}

// Global subscription to the error bus
errorBus.subscribe((error, metadata) => {
  if (metadata) {
    logger.error(`[${metadata.raisedAs || 'System'}] ${metadata.message || error.message}`, error)
  } else {
    logger.error(error)
  }
})
