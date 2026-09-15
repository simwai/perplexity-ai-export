import { createResult, ok, err, type Result } from 'super-result'

export class RateLimiter {
  private readonly limit: number
  private current: number
  private readonly pending: Promise<void>[] = []

  constructor(limit: number) {
    this.limit = limit
    this.current = 0
  }

  async acquire(): Promise<Result<void, Error>> {
    while (this.current >= this.limit) {
      const next = Promise.race(this.pending)
      this.pending.shift()
      await next
    }

    this.current++
    return ok(undefined)
  }

  release(): void {
    this.current--
  }
}
