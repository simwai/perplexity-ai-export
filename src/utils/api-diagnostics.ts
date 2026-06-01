import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger.js'
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

  constructor(private readonly config: Config) {}

  async writeFailure(entry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this.config.debug) return

    try {
      const diagnosticEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      await fs.mkdir(ApiDiagnosticsWriter.DEBUG_DIRECTORY, { recursive: true })
      const diagnosticLogPath = path.join(ApiDiagnosticsWriter.DEBUG_DIRECTORY, ApiDiagnosticsWriter.DIAGNOSTICS_FILENAME)

      const entryAsJsonLine = JSON.stringify(diagnosticEntry) + '\n'
      await fs.appendFile(diagnosticLogPath, entryAsJsonLine, 'utf8')
    } catch (error) {
      logger.warn(`Failed to write API diagnostic: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
