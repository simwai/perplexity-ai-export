import { EventEmitter } from 'node:events'
import { logger } from './logger.js'

export interface AppError {
  message: string
  error?: unknown
  context?: Record<string, unknown>
  timestamp: Date
}

class ErrorBus extends EventEmitter {
  constructor() {
    super()
    // Register a no-op listener for 'error' to prevent Node from throwing
    // when no external listeners are attached.
    this.on('error', () => {})
  }

  emitError(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const appError: AppError = {
      message,
      error,
      context,
      timestamp: new Date(),
    }
    this.emit('error', appError)
    this.logError(appError)
  }

  private logError(appError: AppError): void {
    const ctx = appError.context ? ` | Context: ${JSON.stringify(appError.context)}` : ''
    logger.error(`${appError.message}${ctx}`)

    const isDebug = process.env['DEBUG'] === 'true'
    if (appError.error && isDebug) {
      console.error(appError.error)
    }
  }
}

export const errorBus = new ErrorBus()
