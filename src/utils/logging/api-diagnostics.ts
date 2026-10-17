import { type ZodError, type ZodIssue } from 'zod'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from './logger.js'
import { errorMessageOf } from '../extract-error-message.js'
import { ok, from, type Result } from 'super-result'
import { BaseAppError } from '../errors.js'
import type { Config } from '../config.js'

export class DiagnosticsWriteError extends BaseAppError {}
type DiagnosticsWriteErrorInstance = InstanceType<typeof DiagnosticsWriteError>

export interface ZodErrorDetail {
  path: string
  code: string
  message: string
  received: unknown
  expected: string
  rawResponse?: string
}

export interface ApiDiagnosticEntry {
  timestamp: string
  url: string
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries'
  zodErrorDetails?: ZodErrorDetail[]
  rawResponse?: string
}

type DiagnosticsInput = Config | { readonly debug: boolean }

export class ApiDiagnosticsWriter {
  private readonly debug: boolean

  constructor(input: DiagnosticsInput) {
    this.debug = input.debug
  }

  async writeFailure(
    entry: Omit<ApiDiagnosticEntry, 'timestamp'> & { rawResponse?: string }
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
    entry: Omit<ApiDiagnosticEntry, 'timestamp'> & { rawResponse?: string }
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

function sanitizeResponse(body: string): string {
  return body
    .replace(/\/\/(.+):(.+)@/, '//<redacted>:<redacted>@')
    .replace(
      /"(?:api[_-]?key|token|secret|password|authorization)":\s*"[^"]*"/gi,
      '"$1": "<redacted>"'
    )
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer <redacted>')
}

function truncateResponse(body: string, maxChars = 2000): string {
  if (body.length <= maxChars) return body
  return body.slice(0, maxChars) + '...[truncated]'
}

function issueToDetail(issue: ZodIssue, rawResponse?: string): ZodErrorDetail {
  const path = issue.path.join('.')
  const code = issue.code
  const message = issue.message
  const received =
    'received' in issue ? (issue as ZodIssue & { received: unknown }).received : undefined
  const expected =
    'expected' in issue ? String((issue as ZodIssue & { expected: string }).expected) : 'unknown'

  return {
    path: path || '(root)',
    code,
    message,
    received,
    expected,
    rawResponse,
  }
}

export function zodErrorPaths(result: unknown, rawResponse?: string): ZodErrorDetail[] | undefined {
  const sanitizedRaw = rawResponse ? truncateResponse(sanitizeResponse(rawResponse)) : undefined

  if (result instanceof Error && 'issues' in result) {
    return (result as ZodError).issues.map((issue) => issueToDetail(issue, sanitizedRaw))
  }

  if (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    'error' in result &&
    !(result as { success: boolean }).success
  ) {
    const error = (result as { error: ZodError }).error
    return error.issues.map((issue) => issueToDetail(issue, sanitizedRaw))
  }

  return undefined
}
