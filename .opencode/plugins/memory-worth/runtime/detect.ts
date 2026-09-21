export type Runtime = 'node' | 'bun'

export function detectRuntime(): Runtime {
  const g = globalThis as unknown as { Bun?: unknown }
  if (typeof g.Bun !== 'undefined') return 'bun'
  if (typeof process !== 'undefined' && process.versions?.node) return 'node'
  return 'node'
}

export function isNode(): boolean {
  return detectRuntime() === 'node'
}

export function isBun(): boolean {
  return detectRuntime() === 'bun'
}
