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
  private readonly DEBUG_DIRECTORY = 'debug'
  private readonly DIAGNOSTICS_FILENAME = 'api-diagnostics.jsonl'

  constructor(private readonly config: Config) {}

  async writeFailure(entry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this.config.debug) return

    try {
      const diagnosticEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      await fs.mkdir(this.DEBUG_DIRECTORY, { recursive: true })
      const diagnosticLogPath = path.join(this.DEBUG_DIRECTORY, this.DIAGNOSTICS_FILENAME)

      const entryAsJsonLine = JSON.stringify(diagnosticEntry) + '\n'
      await fs.appendFile(diagnosticLogPath, entryAsJsonLine, 'utf8')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to write API diagnostic: ${errorMessage}`)
    }
  }
}
