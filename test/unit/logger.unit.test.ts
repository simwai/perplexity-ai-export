import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../src/utils/logger.js'

describe('Logger (Unit)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('should NOT log debug messages if DEBUG is false', () => {
    process.env['DEBUG'] = 'false'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('test message')
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('should log debug messages if DEBUG is true', () => {
    process.env['DEBUG'] = 'true'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('test message')
    expect(debugSpy).toHaveBeenCalled()
    const callArgs = debugSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('›')
    expect(callArgs).toContain('test message')
  })

  it('should log info messages via console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('hello world')
    expect(infoSpy).toHaveBeenCalled()
    const callArgs = infoSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('hello world')
  })

  it('should log warn messages via console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('watch out')
    expect(warnSpy).toHaveBeenCalled()
  })

  it('should log error messages via console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('boom')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('should log success via console.log (log level)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.success('done')
    expect(logSpy).toHaveBeenCalled()
    const callArgs = logSpy.mock.calls[0]?.join(' ')
    expect(callArgs).toContain('✓')
  })
})
