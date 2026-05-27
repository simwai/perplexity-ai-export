import chalk from 'chalk'

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
    console.error(chalk.red('✗'), ...args)
  },

  debug(...args: unknown[]): void {
    // We only show debug logs if the DEBUG environment variable is set to true.
    // Note: This is checked at runtime to avoid circular dependencies with config.ts
    if (process.env['DEBUG'] === 'true') {
      console.log(chalk.gray('›'), ...args)
    }
  },
}
