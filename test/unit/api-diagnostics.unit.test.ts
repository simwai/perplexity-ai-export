import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiDiagnosticsWriter } from '../../src/utils/api-diagnostics.js'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { createMockFs } from '../helpers/mock-factories.js'

vi.mock('node:fs/promises')

describe('ApiDiagnosticsWriter (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should write diagnostic entry to jsonl file when debug is true', async () => {
    const writer = new ApiDiagnosticsWriter({ debug: true })
    const entry = {
      url: 'http://test.com',
      errorType: 'unknown_shape' as const,
    }

    await writer.writeFailure(entry)

    expect(fs.mkdir).toHaveBeenCalledWith('debug', { recursive: true })
    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"url":"http://test.com"'),
      'utf8'
    )
  })

  it('should include zodErrorPaths when provided', async () => {
    const writer = new ApiDiagnosticsWriter({ debug: true })
    const entry = {
      url: 'http://test.com',
      errorType: 'zod_error' as const,
      zodErrorPaths: ['entries.0.title'],
    }

    await writer.writeFailure(entry)

    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"zodErrorPaths":["entries.0.title"]'),
      'utf8'
    )
  })

  it('should NOT write diagnostic entry when debug is false', async () => {
    const writer = new ApiDiagnosticsWriter({ debug: false })
    const entry = {
      url: 'http://test.com',
      errorType: 'unknown_shape' as const,
    }

    await writer.writeFailure(entry)

    expect(fs.appendFile).not.toHaveBeenCalled()
  })
})
