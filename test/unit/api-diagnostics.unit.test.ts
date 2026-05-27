import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiDiagnosticsWriter } from '../../src/utils/api-diagnostics.js'
import fs from 'node:fs/promises'
import path from 'node:path'

vi.mock('node:fs/promises')

describe('ApiDiagnosticsWriter (Unit)', () => {
  const mockConfig = { debug: true } as any;
  let writer: ApiDiagnosticsWriter;

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should write diagnostic entry to jsonl file when debug is true', async () => {
    mockConfig.debug = true;
    const entry = {
      url: 'http://test.com',
      errorType: 'unknown_shape' as const,
    }

    await ApiDiagnosticsWriter.writeFailure(entry)

    expect(fs.mkdir).toHaveBeenCalledWith('debug', { recursive: true })
    expect(fs.appendFile).toHaveBeenCalledWith(
      path.join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"url":"http://test.com"'),
      'utf8'
    )
    expect(fs.appendFile).toHaveBeenCalledWith(
      path.join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"errorType":"unknown_shape"'),
      'utf8'
    )
  })

  it('should include zodErrorPaths when provided', async () => {
    mockConfig.debug = true;
    const entry = {
      url: 'http://test.com',
      errorType: 'zod_error' as const,
      zodErrorPaths: ['entries.0.title'],
    }

    await ApiDiagnosticsWriter.writeFailure(entry)

    expect(fs.appendFile).toHaveBeenCalledWith(
      path.join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"zodErrorPaths":["entries.0.title"]'),
      'utf8'
    )
  })
})
