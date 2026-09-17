import { errorMessageOf } from './extract-error-message.js'

export class BaseAppError extends Error {
  constructor(message: string, options?: { cause?: unknown; context?: Record<string, unknown> }) {
    super(message, { cause: options?.cause })
    if (options?.context) {
      Object.assign(this, options.context)
    }
  }
}

export function isTypedError(
  error: unknown,
  ...errorClasses: (new (
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> }
  ) => Error)[]
): boolean {
  return errorClasses.some((ErrorClass) => error instanceof ErrorClass)
}

export function extractErrorContext(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof Error) {
    const { name, message, stack, cause, ...rest } = error
    return Object.keys(rest).length > 0 ? rest : undefined
  }
  return undefined
}

export function formatErrorForLog(error: unknown): string {
  const errorMessage = errorMessageOf(error)
  const ctx = extractErrorContext(error)
  return ctx ? `${errorMessage} | context: ${JSON.stringify(ctx)}` : errorMessage
}
