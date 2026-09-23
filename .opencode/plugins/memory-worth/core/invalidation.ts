import type { MemoryStatus } from './types.js'

export type InvalidationCause = 'contradiction' | 'superseded' | 'revoked'

export interface InvalidationObservation {
  cause: InvalidationCause
  supersededBy?: number
}

// Invalidation is an observation, not a clock: evidence counters are never
// reset here, so a revoked memory keeps its history for audit and recovery.
export function applyInvalidation(
  status: MemoryStatus,
  observation: InvalidationObservation
): MemoryStatus {
  switch (observation.cause) {
    case 'contradiction':
    case 'superseded':
    case 'revoked':
      return status === 'merged' ? status : 'invalidated'
    default:
      return status
  }
}

export function isInvalidated(status: MemoryStatus): boolean {
  return status === 'invalidated'
}
