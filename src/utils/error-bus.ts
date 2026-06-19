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

  emitError(
    errorMessage: string,
    errorObject?: unknown,
    contextMetadata?: Record<string, unknown>
  ): void {
    const applicationError: AppError = {
      message: errorMessage,
      error: errorObject,
      context: contextMetadata,
      timestamp: new Date(),
    }
    this.emit('error', applicationError)
    this.logApplicationError(applicationError)
  }

  raiseError(
    errorMessage: string,
    errorObject?: unknown,
    contextMetadata?: Record<string, unknown>
  ): never {
    this.emitError(errorMessage, errorObject, contextMetadata)
    if (errorObject instanceof Error) {
      throw errorObject
    }
    throw new Error(errorMessage)
  }

  private logApplicationError(applicationError: AppError): void {
    const contextSuffix = applicationError.context
      ? ` | Context: ${JSON.stringify(applicationError.context)}`
      : ''
    logger.error(`${applicationError.message}${contextSuffix}`)

    const isDebugModeActive = process.env['DEBUG'] === 'true'
    if (applicationError.error && isDebugModeActive) {
      console.error(applicationError.error)
    }
  }
}

export const errorBus = new ErrorBus()
