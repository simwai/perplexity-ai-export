import { describe, it, expect, vi, beforeEach } from 'vitest'
import { errorBus } from '../../src/utils/error-bus.js'
import { createMockLogger } from '../helpers/mock-factories.js'

vi.mock('../../src/utils/logger.js', () => {
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  }
  return { logger: mockLogger }
})

import { logger } from '../../src/utils/logger.js'

describe('ErrorBus (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    errorBus.removeAllListeners('error')
  })

  it('should emit errors and trigger the default listener', () => {
    errorBus.on('error', (err) => {
      const contextStr = err.context ? ` | Context: ${JSON.stringify(err.context)}` : ''
      logger.error(`${err.message}${contextStr}`)
    })

    const message = 'Test error message'
    const context = { key: 'value' }

    errorBus.emitError(message, undefined, context)

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify(context)))
  })
})
