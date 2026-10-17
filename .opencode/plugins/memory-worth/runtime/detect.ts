// Runtime detection. Never throws. Safe at module scope: only typeof reads
// and guarded property access, so importing this file cannot crash Node.
type BunHolder = { Bun?: unknown }

function readBunValue(): unknown {
  const holder = globalThis as unknown as BunHolder
  if (typeof holder.Bun === 'undefined') return null
  return holder.Bun
}

function versionOf(candidate: unknown): string | null {
  if (candidate === null) return null
  if (typeof candidate !== 'object' && typeof candidate !== 'function') return null
  const version = (candidate as { version?: unknown }).version
  return typeof version === 'string' ? version : null
}

const BUN_VALUE: unknown = readBunValue()

export const IS_BUN: boolean = versionOf(BUN_VALUE) !== null

// Null on Node. Import IS_BUN (a boolean) only; read BUN inside functions.
export const BUN: unknown = IS_BUN ? BUN_VALUE : null
