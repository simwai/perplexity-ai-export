import { type ZodError } from 'zod'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from './logger.js'
import { errorMessageOf } from './extract-error-message.js'
import { ok, from, type Result } from 'super-result'
import { BaseAppError } from './errors.js'
import type { Config } from './config.js'

export class DiagnosticsWriteError extends BaseAppError {}
type DiagnosticsWriteErrorInstance = InstanceType<typeof DiagnosticsWriteError>

export interface ApiDiagnosticEntry {
  timestamp: string
  url: string
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries'
  zodErrorPaths?: string[]
}

type DiagnosticsInput = Config | { readonly debug: boolean }

export class ApiDiagnosticsWriter {
  private readonly debug: boolean

  constructor(input: DiagnosticsInput) {
    this.debug = input.debug
  }

  async writeFailure(
    entry: Omit<ApiDiagnosticEntry, 'timestamp'>
  ): Promise<Result<void, DiagnosticsWriteErrorInstance>> {
    if (!this.debug) {
      return ok(undefined)
    }

    const result = await this.appendDiagnosticEntry(entry)

    if (!result.ok) {
      logger.warn(`Failed to write API diagnostic: ${errorMessageOf(result.error)}`)
    }

    return result
  }

  private async appendDiagnosticEntry(
    entry: Omit<ApiDiagnosticEntry, 'timestamp'>
  ): Promise<Result<void, DiagnosticsWriteErrorInstance>> {
    return from(async () => {
      const diagnosticEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      const diagnosticLogPath = join('debug', 'api-diagnostics.jsonl')
      await fs.mkdir('debug', { recursive: true })

      const entryAsJsonLine = JSON.stringify(diagnosticEntry) + '\n'
      await fs.appendFile(diagnosticLogPath, entryAsJsonLine, 'utf8')
    })
  }
}

export function zodErrorPaths(result: unknown): string[] | undefined {
  if (result instanceof Error && 'issues' in result) {
    return (result as ZodError).issues.map((issue) => issue.path.join('.'))
  }

  if (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    'error' in result &&
    !(result as { success: boolean }).success
  ) {
    const error = (result as { error: ZodError }).error
    return error.issues.map((issue) => issue.path.join('.'))
  }

  return undefined
}
