export function epochNow(): string {
  return String(Math.floor(Date.now() / 1000))
}

export function epochInt(): number {
  return Math.floor(Date.now() / 1000)
}

export function daysAgo(days: number): string {
  return String(Math.floor(Date.now() / 1000) - days * 86400)
}
