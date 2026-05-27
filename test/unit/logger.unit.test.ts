import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../src/utils/logger.js'
import chalk from 'chalk'

describe('Logger (Unit)', () => {
  const originalEnv = process.env
  let consoleSpy: any

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    consoleSpy.mockRestore()
  })

  it('should NOT log debug messages if DEBUG is false', () => {
    process.env['DEBUG'] = 'false'
    logger.debug('test message')
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('should log debug messages if DEBUG is true', () => {
    process.env['DEBUG'] = 'true'
    logger.debug('test message')
    expect(consoleSpy).toHaveBeenCalledWith(chalk.gray('›'), 'test message')
  })
})
