import { EventEmitter } from 'node:events'
import { logger } from './logger.js'
import { errorMessageOf } from './extract-error-message.js'

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
      const errorContext = appError.context
      const contextSuffix = errorContext ? ` | Context: ${JSON.stringify(errorContext)}` : ''
      logger.error(`${appError.message}${contextSuffix}`)

      const isDebugEnabled = !!process.env['DEBUG']
      if (appError.error && isDebugEnabled) {
        logger.error(errorMessageOf(appError.error))
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
