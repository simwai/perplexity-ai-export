import chalk from 'chalk'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const IS_DEBUG_MODE =
  process.env['DEBUG_MODE'] === 'true' || process.env['DIAGNOSIS_MODE'] === 'true'
const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_LOG_FILENAME = `main-log-${LOG_FILE_TIMESTAMP}.txt`
const MAIN_LOG_PATH = join(LOGS_DIRECTORY, MAIN_LOG_FILENAME)

function writeToLogFile(message: string): void {
  if (!IS_DEBUG_MODE) return

  if (!existsSync(LOGS_DIRECTORY)) {
    mkdirSync(LOGS_DIRECTORY, { recursive: true })
  }

  const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g
  const plainTextLines = message.replace(ANSI_ESCAPE_REGEX, '')
  const logTimestamp = new Date().toISOString()

  appendFileSync(MAIN_LOG_PATH, `[${logTimestamp}] ${plainTextLines}\n`)
}

export const logger = {
  info(...args: unknown[]): void {
    const message = args.join(' ')
    console.log(chalk.blue('ℹ'), message)
    writeToLogFile(`INFO: ${message}`)
  },

  success(...args: unknown[]): void {
    const message = args.join(' ')
    console.log(chalk.green('✓'), message)
    writeToLogFile(`SUCCESS: ${message}`)
  },

  warn(...args: unknown[]): void {
    const message = args.join(' ')
    console.log(chalk.yellow('⚠'), message)
    writeToLogFile(`WARN: ${message}`)
  },

  error(...args: unknown[]): void {
    const message = args.join(' ')
    console.error(chalk.red('✗'), message)
    writeToLogFile(`ERROR: ${message}`)
  },

  debug(...args: unknown[]): void {
    const isVerboseDebug = process.env['DEBUG'] === 'true'
    if (!isVerboseDebug) return

    const message = args.join(' ')
    console.log(chalk.gray('›'), message)
    writeToLogFile(`DEBUG: ${message}`)
  },
}
