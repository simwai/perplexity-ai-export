import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../src/utils/logger.js'

describe('Logger (Unit)', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd()

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    process.chdir(originalCwd)
  })

  afterEach(() => {
    process.env = originalEnv
    process.chdir(originalCwd)
    vi.restoreAllMocks()
  })

  it('uses createColorino for output', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('hello world')
    expect(infoSpy).toHaveBeenCalled()
    const callArgs = infoSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('hello world')
  })

  it('maps success to the log level with the checkmark prefix', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.success('done')
    expect(logSpy).toHaveBeenCalled()
    const callArgs = logSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('✓')
    expect(callArgs).toContain('done')
  })

  it('does not log debug when DEBUG is false', () => {
    process.env['DEBUG'] = 'false'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('test message')
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('logs debug with the debug prefix when DEBUG is true', () => {
    process.env['DEBUG'] = 'true'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('test message')
    expect(debugSpy).toHaveBeenCalled()
    const callArgs = debugSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('›')
    expect(callArgs).toContain('test message')
  })

  it('redacts sensitive keys before logging via colorino sanitization', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('token', { secret: 'secret-token' })
    expect(infoSpy).toHaveBeenCalled()
    const callArgs = infoSpy.mock.calls[0]?.join(' ')
    expect(callArgs).not.toContain('secret-token')
  })
})
