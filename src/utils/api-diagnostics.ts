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
  private readonly debugDir = 'debug'
  private readonly logFile = 'api-diagnostics.jsonl'

  constructor(private config: Config) {}

  async writeFailure(entry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this.config.debug) return

    try {
      const fullEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      await fs.mkdir(this.debugDir, { recursive: true })
      const logPath = path.join(this.debugDir, this.logFile)
      await fs.appendFile(logPath, JSON.stringify(fullEntry) + '\n', 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to write API diagnostic: ${message}`)
    }
  }
}
