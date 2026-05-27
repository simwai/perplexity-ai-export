import chalk from 'chalk'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIAGNOSIS_MODE = process.env['DIAGNOSIS_MODE'] === 'true'
const LOGS_DIR = 'logs'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_LOG_PATH = join(LOGS_DIR, `main-log-${TIMESTAMP}.txt`)

function writeToFile(message: string): void {
  if (!DIAGNOSIS_MODE) return

  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }

  const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '')
  appendFileSync(MAIN_LOG_PATH, `[${new Date().toISOString()}] ${cleanMessage}\n`)
}

export const logger = {
  info(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.blue('ℹ'), msg)
    writeToFile(`INFO: ${msg}`)
  },

  success(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.green('✓'), msg)
    writeToFile(`SUCCESS: ${msg}`)
  },

  warn(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.yellow('⚠'), msg)
    writeToFile(`WARN: ${msg}`)
  },

  error(...args: unknown[]): void {
    const msg = args.join(' ')
    console.error(chalk.red('✗'), msg)
    writeToFile(`ERROR: ${msg}`)
  },

  debug(...args: unknown[]): void {
    const msg = args.join(' ')
    console.log(chalk.gray('›'), msg)
    writeToFile(`DEBUG: ${msg}`)
  },
}
