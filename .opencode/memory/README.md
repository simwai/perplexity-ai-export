# Memory Worth

Persistent, self-maintaining memory for OpenCode with a trust signal the agent tunes itself.

## What this is

A plugin that gives the OpenCode assistant a memory that persists across sessions. The assistant decides what to store, update, merge, or delete. Each memory carries a trust score derived from whether it co-occurred with successful task outcomes.

## What this is not

This is not a training loop. There is no background daemon, no network calls at runtime, and no automatic parameter tuning. The intelligence lives in the agent, not in a training pipeline.

## Trust scores are associational, not causal

A memory's score reflects how often it appeared alongside success, not whether it caused success. This is honest about what the signal can and cannot tell you.

### Two confounds to be aware of

1. **Task difficulty confounding**: memories about hard problems look bad simply because hard tasks fail more. Partitioning trust scores by task type fixes this.
2. **Co-retrieval confounding**: a memory retrieved alongside a successful memory gets credit it may not deserve. Retrieval diversity (searching broadly, not just taking the top result) mitigates this.

## Storage

 Memories are stored in `.opencode/memory/memories.db` using SQLite via the Turso/libsql driver in local-file mode. No network calls. No separate server.

## Tools

| Tool | Purpose |
|---|---|
| `memory_store` | Save a memory. Refuses near-duplicates; points to the existing memory instead. |
| `memory_search` | Full-text search with trust-aware ranking. Returns high/neutral/low/unproven labels. |
| `memory_update` | Reword a memory. Preserves accumulated trust scores. |
| `memory_merge` | Combine two memories. Adds their evidence together; inherits the stronger signal. |
| `memory_delete` | Permanently remove a memory. |
| `memory_dashboard` | Health report: calibration, discrimination, distribution, and named flags. |
| `memory_tune` | Adjust one tuning knob. Requires a written rationale. Change is logged. |
| `memory_get_params` | Inspect current knob values. |
| `memory_get_audit` | Read the tuning audit log. |
| `memory_reset` | Wipe all memories, outcomes, and audit log. Preserves tuning params. |

## Tuning knobs

| Knob | Controls | Bounds |
|---|---|---|
| `decay_rate` | How quickly old observations stop mattering | 0 < rate < 1 |
| `trust_quantile` | What fraction of memories count as "high trust" | 0 < rate < 1 |
| `doubt_quantile` | What fraction count as "low trust" | 0 < rate < 1 |
| `min_evidence` | How many observations before a memory can be trusted or doubted | positive integer |
| `active_partition` | Which task-type bucket retrieval currently prefers | existing partition name |

Constraints:
- `trust_quantile` must be greater than `doubt_quantile`
- `active_partition` must be an existing task type in the database

## Decision table for tuning

Use this table as a guide, not a rule. Explain your reasoning in the rationale.

| Dashboard flag | Suggested action |
|---|---|
| calibration is degrading | lower the decay rate |
| my scores are worse than guessing | raise the minimum-evidence threshold |
| too many stale memories | raise the doubt quantile |
| too few trusted memories | lower the trust quantile |
| one partition is misbehaving | switch the active partition |
| not enough data | do nothing |

## When to tune

Tune roughly every 50 tasks, not every task. The dashboard reports how many tasks have elapsed since the last tuning cycle. Do not tune when the dashboard reports insufficient data. Do not change more than one knob per cycle.

## Fresh install behavior

On first run with an empty database, the dashboard reports "insufficient data" rather than producing nulls, NaNs, or errors. The agent can start writing memories immediately. The first tuning cycle happens only after enough data exists to make it meaningful.

## Inspectability and reversibility

- The audit log of tuning changes is a plain record in the database (`tuning_audit` table).
- `memory_get_audit` shows what the agent has changed and why.
- `memory_reset` wipes all memories and outcomes but preserves tuning params.
- `memory_get_params` shows the current knob values at any time.
