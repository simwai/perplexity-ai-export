import fs from 'node:fs/promises'
import { logger } from './logger.js'
import { joinFromRoot } from './paths.js'
import { type Config } from './config.js'

export interface ApiDiagnosticEntry {
  timestamp: string
  url: string
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries'
  zodErrorPaths?: string[]
}

export class ApiDiagnosticsWriter {
  private _config: Config

  constructor(config: Config) {
    this._config = config
  }

  async writeFailure(entry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this._config.debug) return

    try {
      const fullEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      const debugDir = joinFromRoot('debug')
      await fs.mkdir(debugDir, { recursive: true })
      const logPath = joinFromRoot('debug', 'api-diagnostics.jsonl')

      await fs.appendFile(logPath, JSON.stringify(fullEntry) + '\n', 'utf8')
    } catch (error) {
      logger.warn(
        `Failed to write API diagnostic: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
