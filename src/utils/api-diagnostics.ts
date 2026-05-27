import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { type Config } from './config.js';

export interface ApiDiagnosticEntry {
  timestamp: string;
  url: string;
  errorType: 'unknown_shape' | 'zod_error' | 'empty_entries';
  zodErrorPaths?: string[];
}

export class ApiDiagnosticsWriter {
  private static readonly DEBUG_DIR = 'debug';
  private static readonly LOG_FILE = 'api-diagnostics.jsonl';
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async writeFailure(entry: Omit<ApiDiagnosticEntry, 'timestamp'>): Promise<void> {
    if (!this.config.debug) return;

    try {
      const fullEntry: ApiDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };

      await fs.mkdir(ApiDiagnosticsWriter.DEBUG_DIR, { recursive: true });
      const logPath = path.join(ApiDiagnosticsWriter.DEBUG_DIR, ApiDiagnosticsWriter.LOG_FILE);

      await fs.appendFile(logPath, JSON.stringify(fullEntry) + '\n', 'utf8');
    } catch (error) {
      logger.warn(`Failed to write API diagnostic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
