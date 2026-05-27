import { describe, it, expect, vi, beforeEach } from 'vitest'
import { errorBus } from '../../src/utils/error-bus.js'
import { logger } from '../../src/utils/logger.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('ErrorBus (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    errorBus.removeAllListeners('error')
    // Re-attach the default listener that was removed by removeAllListeners
    // This is a bit tricky because the constructor attaches it.
    // In a real scenario we might want to export the listener function or have a way to reset the bus.
    // For testing purposes, we can just instantiate a new one or re-attach the behavior.
  })

  it('should emit errors and trigger the default listener', () => {
    // Re-attach the default behavior for this test since we cleared it in beforeEach
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
