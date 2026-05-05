import chalk from 'chalk'
import { inspect } from 'node:util'

export const logger = {
  info(...args: unknown[]): void {
    console.log(chalk.blue('ℹ'), ...args)
  },

  success(...args: unknown[]): void {
    console.log(chalk.green('✓'), ...args)
  },

  warn(...args: unknown[]): void {
    const processedArgs = args.map((arg) => {
      if (arg instanceof Error) {
        return inspect(arg, { depth: null, colors: true })
      }
      return arg
    })
    console.log(chalk.yellow('⚠'), ...processedArgs)
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
