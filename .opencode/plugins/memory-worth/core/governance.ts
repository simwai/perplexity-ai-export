import type { GovernancePolicy, MemoryStatus, TuningParams, TuningAuditEntry } from './types.js'
import { ok, err, Result, from } from './result.js'

export const DEFAULT_GOVERNANCE_POLICY: GovernancePolicy = {
  invalidation_threshold: 0.2,
  merge_similarity_threshold: 0.85,
  auto_archive_after_days: 30,
  max_evidence_per_partition: 1000,
}

export const DEFAULT_TUNING_PARAMS: TuningParams = {
  decay_rate: 0.3,
  trust_quantile: 0.3,
  doubt_quantile: 0.3,
  min_evidence: 5,
  active_partition: 'general',
}

export function validateTuningParams(params: Partial<TuningParams>): Result<void, string> {
  if (params.decay_rate !== undefined) {
    if (params.decay_rate <= 0 || params.decay_rate >= 1)
      return err('decay_rate must be between 0 and 1 (exclusive)')
  }
  if (params.trust_quantile !== undefined && params.doubt_quantile !== undefined) {
    if (params.trust_quantile <= params.doubt_quantile)
      return err('trust_quantile must be greater than doubt_quantile')
  }
  if (params.trust_quantile !== undefined) {
    if (params.trust_quantile <= 0 || params.trust_quantile >= 1)
      return err('trust_quantile must be between 0 and 1 (exclusive)')
  }
  if (params.doubt_quantile !== undefined) {
    if (params.doubt_quantile <= 0 || params.doubt_quantile >= 1)
      return err('doubt_quantile must be between 0 and 1 (exclusive)')
  }
  if (params.min_evidence !== undefined) {
    if (!Number.isInteger(params.min_evidence) || params.min_evidence < 1)
      return err('min_evidence must be a positive integer')
  }
  return ok(undefined)
}

export function shouldInvalidate(
  trustScore: number,
  policy: GovernancePolicy,
  ageDays: number
): boolean {
  if (trustScore < policy.invalidation_threshold) return true
  if (ageDays > policy.auto_archive_after_days) return true
  return false
}

export function computeStatus(
  trustLabel: string,
  ageDays: number,
  policy: GovernancePolicy
): MemoryStatus {
  if (trustLabel === 'low' && ageDays > 7) return 'archived'
  if (ageDays > policy.auto_archive_after_days) return 'archived'
  return 'active'
}

export function createAuditEntry(
  changedBy: string,
  rationale: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>
): TuningAuditEntry {
  return {
    changed_at: new Date().toISOString(),
    changed_by: changedBy,
    rationale,
    old_values: oldValues,
    new_values: newValues,
  }
}
