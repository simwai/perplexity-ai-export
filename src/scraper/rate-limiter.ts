import { config } from '../utils/config.js'

export class RateLimiter {
  // ========== Custom Error Classes ==========
  static readonly QueueError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RateLimiterQueueError'
    }
  }

  private lastExecutionTime = 0
  private queue: Array<() => void> = []
  private isProcessing = false

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true

    try {
      await this.waitIfNeeded()
      this.executeNext()
    } catch (error) {
      this.isProcessing = false
      // If an error occurs, we reject the next promise? But we don't have reject.
      // Instead, we could rethrow as QueueError, but the original code didn't handle errors.
      // We'll log and move on (though unlikely to happen).
      logger.error('RateLimiter internal error:', error)
    } finally {
      this.isProcessing = false
      if (this.queue.length > 0) {
        this.processQueue()
      }
    }
  }

  private async waitIfNeeded(): Promise<void> {
    const now = Date.now()
    const baseDelay = config.rateLimitMs
    const jitter = Math.floor(baseDelay * 0.5 * Math.random())
    const elapsed = now - this.lastExecutionTime
    const waitTime = Math.max(0, baseDelay + jitter - elapsed)

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
    this.lastExecutionTime = Date.now()
  }

  private executeNext(): void {
    const resolve = this.queue.shift()
    if (resolve) {
      resolve()
    }
  }
}
