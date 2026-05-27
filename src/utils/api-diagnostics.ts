import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import type { Config } from './config.js';

export interface ApiDiagnosticEntry {
  timestamp: string
  url: string
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries'
  zodErrorPaths?: string[]
}

export class ApiDiagnosticsWriter {
  private static readonly DEBUG_DIR = 'debug'
  private static readonly LOG_FILE = 'api-diagnostics.jsonl'

    try {
      const fullEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      }

      await fs.mkdir(this.DEBUG_DIR, { recursive: true })
      const logPath = path.join(this.DEBUG_DIR, this.LOG_FILE)

      await fs.appendFile(logPath, JSON.stringify(fullEntry) + '\n', 'utf8')
    } catch (error) {
      logger.warn(
        `Failed to write API diagnostic: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}