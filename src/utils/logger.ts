import chalk from 'chalk'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function isVerboseLoggingEnabled(): boolean {
  return process.env['DEBUG'] === 'true'
}

const LOGS_ROOT_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP_IDENTIFIER = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_APPLICATION_LOG_FILENAME = `main-log-${LOG_FILE_TIMESTAMP_IDENTIFIER}.txt`
const MAIN_LOG_FILE_PATH = join(LOGS_ROOT_DIRECTORY, MAIN_APPLICATION_LOG_FILENAME)

function writeMessageToFile(logMessage: string): void {
  if (!isVerboseLoggingEnabled()) return

  if (!existsSync(LOGS_ROOT_DIRECTORY)) {
    mkdirSync(LOGS_ROOT_DIRECTORY, { recursive: true })
  }

  const ANSI_COLOR_CODE_REGEX = /\x1b\[[0-9;]*m/g
  const plainTextMessage = logMessage.replace(ANSI_COLOR_CODE_REGEX, '')
  const currentTimestamp = new Date().toISOString()

  appendFileSync(MAIN_LOG_FILE_PATH, `[${currentTimestamp}] ${plainTextMessage}\n`)
}

export const logger = {
  info(...messageArguments: unknown[]): void {
    const combinedMessage = messageArguments.join(' ')
    console.log(chalk.blue('ℹ'), combinedMessage)
    writeMessageToFile(`INFO: ${combinedMessage}`)
  },
  success(...messageArguments: unknown[]): void {
    const combinedMessage = messageArguments.join(' ')
    console.log(chalk.green('✓'), combinedMessage)
    writeMessageToFile(`SUCCESS: ${combinedMessage}`)
  },
  warn(...messageArguments: unknown[]): void {
    const combinedMessage = messageArguments.join(' ')
    console.log(chalk.yellow('⚠'), combinedMessage)
    writeMessageToFile(`WARN: ${combinedMessage}`)
  },
  error(...messageArguments: unknown[]): void {
    const combinedMessage = messageArguments.join(' ')
    console.error(chalk.red('✗'), combinedMessage)
    writeMessageToFile(`ERROR: ${combinedMessage}`)
  },
  debug(...messageArguments: unknown[]): void {
    if (!isVerboseLoggingEnabled()) return
    const combinedMessage = messageArguments.join(' ')
    console.log(chalk.gray('›'), combinedMessage)
    writeMessageToFile(`DEBUG: ${combinedMessage}`)
  },
}
