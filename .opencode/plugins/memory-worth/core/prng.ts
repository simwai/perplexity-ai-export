import { ok, err, Result, from } from './result.js'

export function createSeededRandom(seed: number): () => number {
  let s = seed | 0
  if (s === 0) s = 1

  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h
}

export function createSeededRandomResult(seed: number): Result<() => number, Error> {
  return from(() => createSeededRandom(seed))
}
