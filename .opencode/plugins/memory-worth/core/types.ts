export type TrustLabel = 'high' | 'neutral' | 'low' | 'unproven'

export type MemoryStatus = 'active' | 'archived' | 'invalidated' | 'merged'

export type Outcome = boolean | null

export type PartitionData = Record<
  string,
  { ema_success: number; ema_failure: number; evidence_count: number }
>

export interface Memory {
  id: number
  content: string
  tags: string
  task_type: string
  created_at: string
  updated_at: string
  deleted_at: string | undefined
  ema_success: number
  ema_failure: number
  evidence_count: number
  partition_data: PartitionData
  metadata: Record<string, unknown>
  status: MemoryStatus
  trust_label: TrustLabel
  trust_score: number
}

export interface MemoryInput {
  content: string
  tags?: string
  task_type?: string
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  id: number
  content: string
  tags: string
  task_type: string
  trust_label: TrustLabel
  trust_score: number
  evidence_count: number
  created_at: string
  rank: number
}

export interface TuningParams {
  decay_rate: number
  trust_quantile: number
  doubt_quantile: number
  min_evidence: number
  active_partition: string
}

export interface GovernancePolicy {
  invalidation_threshold: number
  merge_similarity_threshold: number
  auto_archive_after_days: number
  max_evidence_per_partition: number
}

export interface TrustScore {
  ema_success: number
  ema_failure: number
  evidence_count: number
  score: number
  label: TrustLabel
}

export interface OutcomeRecord {
  session_id: string
  task_type: string
  outcome: Outcome
  logged_at: string
}

export interface MemoryTrust {
  s_plus: number
  s_minus: number
  mw: number
}

export interface Episode {
  id: number
  session_id: string
  task_type: string
  started_at: string
  resolved_at: string | undefined
  outcome: Outcome
}

export interface CalibrationEntry {
  episode_id: number
  memory_id: number
  mw_before: number
}

export interface TuningAuditEntry {
  changed_at: string
  changed_by: string
  rationale: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
}
