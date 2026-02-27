import { config } from '../utils/config.js'

export class RateLimiter {
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

    const now = Date.now()
    const baseDelay = config.rateLimitMs
    const jitter = Math.floor(baseDelay * 0.5 * Math.random()) // 0–50% extra
    const elapsed = now - this.lastExecutionTime
    const waitTime = Math.max(0, baseDelay + jitter - elapsed)

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }

    this.lastExecutionTime = Date.now()
    const resolve = this.queue.shift()
    if (resolve) {
      resolve()
    }

    this.isProcessing = false

    if (this.queue.length > 0) {
      this.processQueue()
    }
  }
}
