export class RateLimiter {
  private readonly limit: number
  private current: number
  private readonly waiters: (() => void)[] = []

  constructor(limit: number) {
    this.limit = limit
    this.current = 0
  }

  async acquire(): Promise<void> {
    if (this.current < this.limit) {
      this.current++
      return
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
    this.current++
  }

  release(): void {
    this.current--
    const next = this.waiters.shift()
    if (next) {
      next()
    }
  }
}
