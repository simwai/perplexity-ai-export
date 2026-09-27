import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../../src/utils/logging/api-diagnostics.js'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { createMockFs } from '../helpers/mock-factories.js'
import { z } from 'zod'

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

  it('should include zodErrorDetails when provided', async () => {
    const writer = new ApiDiagnosticsWriter({ debug: true })
    const schema = z.object({ title: z.string() })
    const result = schema.safeParse({ title: 123 })
    const details = zodErrorPaths(result, '{"title":123}')

    const entry = {
      url: 'http://test.com',
      errorType: 'zod_error' as const,
      zodErrorDetails: details,
      rawResponse: '{"title":123}',
    }

    await writer.writeFailure(entry)

    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"zodErrorDetails"'),
      'utf8'
    )
    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"path":"title"'),
      'utf8'
    )
    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"code":"invalid_type"'),
      'utf8'
    )
    expect(fs.appendFile).toHaveBeenCalledWith(
      join('debug', 'api-diagnostics.jsonl'),
      expect.stringContaining('"rawResponse":"{\\"title\\":123}"'),
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
