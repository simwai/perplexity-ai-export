import { createColorino } from 'colorino'
import { join } from 'node:path'

const IS_DEBUG_MODE =
  process.env['DEBUG_MODE'] === 'true' || process.env['DIAGNOSIS_MODE'] === 'true'
const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_LOG_FILENAME = `main-log-${LOG_FILE_TIMESTAMP}.txt`
const MAIN_LOG_PATH = join(LOGS_DIRECTORY, MAIN_LOG_FILENAME)

const baseLogger = createColorino(
  {
    error: '#ff5555',
    warn: '#ffb86c',
    info: '#8be9fd',
    log: '#50fa7b',
    debug: '#bd93f9',
    trace: '#6272a4',
  },
  {
    level: 'trace',
    ...(IS_DEBUG_MODE
      ? {
          fileLogging: {
            path: MAIN_LOG_PATH,
            maxBytes: 10 * 1024 * 1024,
            maxFiles: 5,
            stripAnsi: true,
          },
        }
      : {}),
  }
)

export const logger = {
  info(...args: unknown[]): void {
    baseLogger.info('ℹ', ...args)
  },

  success(...args: unknown[]): void {
    baseLogger.log('✓', ...args)
  },

  warn(...args: unknown[]): void {
    baseLogger.warn('⚠', ...args)
  },

  error(...args: unknown[]): void {
    baseLogger.error('✗', ...args)
  },

  debug(...args: unknown[]): void {
    const isVerboseDebug = process.env['DEBUG'] === 'true'
    if (!isVerboseDebug) return
    baseLogger.debug('›', ...args)
  },

  log(...args: unknown[]): void {
    baseLogger.log(...args)
  },

  trace(...args: unknown[]): void {
    baseLogger.trace(...args)
  },
}
