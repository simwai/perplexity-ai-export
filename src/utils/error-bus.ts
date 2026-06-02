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
    this.on('error', () => {})
  }

  emitError(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const appError: AppError = { message, error, context, timestamp: new Date() }
    this.emit('error', appError)
    this.logError(appError)
  }

  raiseError(message: string, error?: unknown, context?: Record<string, unknown>): never {
    this.emitError(message, error, context)
    if (error instanceof Error) throw error
    throw new Error(message)
  }

  private logError(appError: AppError): void {
    const ctx = appError.context ? ` | Context: ${JSON.stringify(appError.context)}` : ''
    logger.error(`${appError.message}${ctx}`)

    if (appError.error && process.env['DEBUG'] === 'true') {
      console.error(appError.error)
    }
  }
}

export const errorBus = new ErrorBus()
