import chalk from 'chalk'
import { appendFileSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'

// File-based debug log. Lives at <cwd>/debug.log (gitignored via *.log) and
// receives every line that goes to the console, plus a timestamp + level
// prefix. Designed to make post-mortem diagnosis possible without re-running.
const DEBUG_LOG_PATH = resolve(process.cwd(), 'debug.log')

let fileLoggingDisabled = false

// Touch the file on startup and write a session header so multiple runs are
// distinguishable. Disable file logging silently if we cannot open it (e.g.
// read-only filesystem) — never break the app for a debug log.
try {
  const fd = openSync(DEBUG_LOG_PATH, 'a')
  closeSync(fd)
  appendFileSync(
    DEBUG_LOG_PATH,
    `\n========== session start ${new Date().toISOString()} pid=${process.pid} ==========\n`
  )
} catch {
  fileLoggingDisabled = true
}

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
}

function formatArgForFile(arg: unknown): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'string') return stripAnsi(arg)
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`
  }
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function appendToFile(level: string, args: unknown[]): void {
  if (fileLoggingDisabled) return
  try {
    const timestamp = new Date().toISOString()
    const body = args.map(formatArgForFile).join(' ')
    appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] [${level}] ${body}\n`)
  } catch {
    // Disable on first failure so we don't spam errors.
    fileLoggingDisabled = true
  }
}

export const logger = {
  info(...args: unknown[]): void {
    console.log(chalk.blue('ℹ'), ...args)
    appendToFile('INFO', args)
  },

  success(...args: unknown[]): void {
    console.log(chalk.green('✓'), ...args)
    appendToFile('OK', args)
  },

  warn(...args: unknown[]): void {
    console.log(chalk.yellow('⚠'), ...args)
    appendToFile('WARN', args)
  },

  error(...args: unknown[]): void {
    console.error(chalk.red('✗'), ...args)
    appendToFile('ERROR', args)
  },

  debug(...args: unknown[]): void {
    console.log(chalk.gray('›'), ...args)
    appendToFile('DEBUG', args)
  },
}

export const debugLogPath = DEBUG_LOG_PATH
