import type { Value } from '@libsql/core/api'

export function asNumber(value: Value | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error('Expected numeric database value')
}

export function asText(value: Value | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  throw new Error('Expected text database value')
}

export function asOptionalText(value: Value | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  return asText(value)
}
