import { IS_BUN, BUN } from '../detect.js'
import { isRecord } from '../../core/result.js'

// 32-bit fingerprint, hex-encoded. Stable within a runtime by construction;
// Bun and Node branches use different algorithms, so values are not portable
// across runtimes. Used for fingerprints, never for persisted identity.
export function hash32(input: string): string {
  if (
    IS_BUN &&
    isRecord(BUN) &&
    isRecord(BUN['hash']) &&
    typeof BUN['hash']['xxHash32'] === 'function'
  ) {
    const digest: unknown = BUN['hash']['xxHash32'](input)
    if (typeof digest === 'number') return digest.toString(16).padStart(8, '0')
  }
  return (cyrb53(input) >>> 0).toString(16).padStart(8, '0')
}

function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0)
}
