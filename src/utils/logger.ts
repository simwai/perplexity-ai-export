import { createColorino } from 'colorino'
import { join } from 'node:path'

const IS_DEBUG_MODE =
  process.env['DEBUG_MODE'] === 'true' || process.env['DIAGNOSIS_MODE'] === 'true'
const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const MAIN_LOG_FILENAME = `main-log-${LOG_FILE_TIMESTAMP}.txt`
const MAIN_LOG_PATH = join(LOGS_DIRECTORY, MAIN_LOG_FILENAME)

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|cookie|password|api[_-]?key|access[_-]?token|bearer/i

/**
 * Redact sensitive values from an unknown payload before logging.
 *
 * why: logger args can include request/response bodies; this prevents secrets
 * from reaching the console or file log.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return obj.map(redactSensitiveData)
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redactSensitiveData(value)
      }
    }
    return result
  }
  return obj
}

export function redactArgs(args: unknown[]): unknown[] {
  return args.map(redactSensitiveData)
}

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

function logWithRedaction(
  level: 'info' | 'success' | 'warn' | 'error' | 'debug' | 'log' | 'trace',
  prefix: string,
  args: unknown[]
): void {
  const redacted = redactArgs(args)
  const colorinoLevel = level === 'success' ? 'log' : level
  ;(baseLogger[colorinoLevel] as (...args: unknown[]) => void)(prefix, ...redacted)
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
