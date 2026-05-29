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
    this.on('error', (appError: AppError) => {
      const contextSuffix = appError.context
        ? ` | Context: ${JSON.stringify(appError.context)}`
        : ''
      logger.error(`${appError.message}${contextSuffix}`)

      const isDebugEnabled = process.env['DEBUG'] === 'true' || process.env['DEBUG_MODE'] === 'true'
      if (appError.error && isDebugEnabled) {
        console.error(appError.error)
      }
    })
  }

  emitError(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const appError: AppError = {
      message,
      error,
      context,
      timestamp: new Date(),
    }
    this.emit('error', appError)
  }
}

export const errorBus = new ErrorBus()
