export function buildSystemPrompt(): string {
  return [
    'MEMORY-WORTH memory policy: trust is associational, never causal.',
    'Search memory before answering when prior context could help; store durable insights with memory_write (applies_when is required); prefer updating over duplicating.',
    'Trust labels are population quantiles: high co-occurred with success, low with failure, unproven means too little evidence.',
    'Write-time constraints beat post-hoc filters: ground memories to files, symbols, or git refs.',
  ].join(' ')
}
