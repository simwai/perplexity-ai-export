import { EventEmitter } from 'node:events'

export type ErrorReporter = (error: Error, metadata?: Record<string, unknown>) => void

class ErrorBus extends EventEmitter {
  private static readonly ERROR_EVENT = 'error'

  report(error: unknown, metadata?: Record<string, unknown>): void {
    const errorObject = error instanceof Error ? error : new Error(String(error))
    this.emit(ErrorBus.ERROR_EVENT, errorObject, metadata)
  }

  subscribe(reporter: ErrorReporter): void {
    this.on(ErrorBus.ERROR_EVENT, reporter)
  }

  /**
   * Helper to both report and return a custom error for throwing.
   */
  raise<T extends new (message: string) => Error>(
    ErrorClass: T,
    message: string,
    originalError?: unknown
  ): InstanceType<T> {
    const error = new ErrorClass(message)
    this.report(originalError || error, { raisedAs: error.name, message })
    return error as InstanceType<T>
  }
}

export const errorBus = new ErrorBus()
