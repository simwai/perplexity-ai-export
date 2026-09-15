import { createColorino } from 'colorino'
import { join } from 'node:path'

const IS_DEBUG_MODE = process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '"true"'
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
    sanitization: {
      enabled: true,
      keys: [
        'token',
        'secret',
        'authorization',
        'cookie',
        'password',
        'apiKey',
        'accessToken',
        'bearer',
      ],
      replacement: '[REDACTED]',
    },
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

function logWithRedaction(
  level: 'info' | 'success' | 'warn' | 'error' | 'debug' | 'log' | 'trace',
  prefix: string,
  args: unknown[]
): void {
  const colorinoLevel = level === 'success' ? 'log' : level
  ;(baseLogger[colorinoLevel] as (...args: unknown[]) => void)(prefix, ...args)
}

export const logger = {
  info(...args: unknown[]): void {
    logWithRedaction('info', 'ℹ', args)
  },

  success(...args: unknown[]): void {
    logWithRedaction('log', '✓', args)
  },

  warn(...args: unknown[]): void {
    logWithRedaction('warn', '⚠', args)
  },

  error(...args: unknown[]): void {
    logWithRedaction('error', '✗', args)
  },

  debug(...args: unknown[]): void {
    const isVerboseDebug = process.env['DEBUG'] === 'true'
    if (!isVerboseDebug) return
    logWithRedaction('debug', '›', args)
  },

  log(...args: unknown[]): void {
    logWithRedaction('log', '', args)
  },

  trace(...args: unknown[]): void {
    logWithRedaction('trace', '', args)
  },
}
