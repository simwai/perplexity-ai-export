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
    this.on('error', (err: AppError) => {
      const contextStr = err.context ? ` | Context: ${JSON.stringify(err.context)}` : ''
      logger.error(`${err.message}${contextStr}`)
      if (err.error) {
        if (process.env['DEBUG'] === 'true' || process.env['DEBUG_MODE'] === 'true') {
          console.error(err.error)
        }
      }
    })
  }

  emitError(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.emit('error', {
      message,
      error,
      context,
      timestamp: new Date(),
    })
  }
}

export const errorBus = new ErrorBus()
