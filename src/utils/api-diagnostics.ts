import fileSystem from 'node:fs/promises'
import path from 'node:path'
import { errorBus } from './error-bus.js'
import type { Config } from './config.js'

export interface ApiDiagnosticEntry {
  timestamp: string
  url: string
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries'
  zodErrorPaths?: string[]
}

export class ApiDiagnosticsWriter {
  private static readonly DEBUG_DIRECTORY = 'debug'
  private static readonly DIAGNOSTICS_FILENAME = 'api-diagnostics.jsonl'

  constructor(private readonly applicationConfig: Config) {}

  async writeFailure(failureEntry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this.applicationConfig.debug) return

    try {
      const diagnosticEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...failureEntry,
      }

      await fileSystem.mkdir(ApiDiagnosticsWriter.DEBUG_DIRECTORY, { recursive: true })
      const diagnosticLogPath = path.join(ApiDiagnosticsWriter.DEBUG_DIRECTORY, ApiDiagnosticsWriter.DIAGNOSTICS_FILENAME)

      const diagnosticEntryAsJsonLine = JSON.stringify(diagnosticEntry) + '\n'
      await fileSystem.appendFile(diagnosticLogPath, diagnosticEntryAsJsonLine, 'utf8')
    } catch (failureError) {
      errorBus.emitError('Failed to write API diagnostic', failureError)
    }
  }
}
