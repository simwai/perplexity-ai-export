import chalk from 'chalk'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function isDebug(): boolean {
  return process.env['DEBUG'] === 'true'
}

const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_LOG_FILENAME = `main-log-${LOG_FILE_TIMESTAMP}.txt`
const MAIN_LOG_PATH = join(LOGS_DIRECTORY, MAIN_LOG_FILENAME)

function writeToLogFile(message: string): void {
  if (!isDebug()) return
  if (!existsSync(LOGS_DIRECTORY)) mkdirSync(LOGS_DIRECTORY, { recursive: true })

  const plainTextLines = message.replace(/\x1b\[[0-9;]*m/g, '')
  const logTimestamp = new Date().toISOString()
  appendFileSync(MAIN_LOG_PATH, `[${logTimestamp}] ${plainTextLines}\n`)
}

export const logger = {
  info(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.blue('ℹ'), msg)
    writeToLogFile(`INFO: ${msg}`)
  },
  success(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.green('✓'), msg)
    writeToLogFile(`SUCCESS: ${msg}`)
  },
  warn(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.yellow('⚠'), msg)
    writeToLogFile(`WARN: ${msg}`)
  },
  error(...args: unknown[]): void {
    const msg = args.join(' ')
    console.error(chalk.red('✗'), msg)
    writeToLogFile(`ERROR: ${msg}`)
  },
  debug(...args: unknown[]): void {
    if (!isDebug()) return
    const msg = args.join(' ')
    console.log(chalk.gray('›'), msg)
    writeToLogFile(`DEBUG: ${msg}`)
  },
}
