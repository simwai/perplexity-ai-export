import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiDiagnosticsWriter } from '../../src/utils/api-diagnostics.js';
import { config } from '../../src/utils/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises');
vi.mock('../../src/utils/config.js', () => ({
  config: {
    debug: true
  }
}));

describe('ApiDiagnosticsWriter (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write diagnostic entry to jsonl file when debug is true', async () => {
    (config as any).debug = true;
    const entry = {
      url: 'http://test.com',
      errorType: 'unknown_shape' as const,
    };

    await ApiDiagnosticsWriter.writeFailure(entry);

    expect(fs.mkdir).toHaveBeenCalledWith('debug', { recursive: true });
    expect(fs.appendFile).toHaveBeenCalledWith(
      path.join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"url":"http://test.com"'),
      'utf8'
    );
  });

  it('should include zodErrorPaths when provided', async () => {
    (config as any).debug = true;
    const entry = {
      url: 'http://test.com',
      errorType: 'zod_error' as const,
      zodErrorPaths: ['entries.0.title'],
    };

    await ApiDiagnosticsWriter.writeFailure(entry);

    expect(fs.appendFile).toHaveBeenCalledWith(
      path.join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"zodErrorPaths":["entries.0.title"]'),
      'utf8'
    );
  });

  it('should NOT write diagnostic entry when debug is false', async () => {
    (config as any).debug = false;
    const entry = {
      url: 'http://test.com',
      errorType: 'unknown_shape' as const,
    };

    await ApiDiagnosticsWriter.writeFailure(entry);

    expect(fs.appendFile).not.toHaveBeenCalled();
  });
});
