---
description: Switch REVIEW cadence to consolidated mode for auto-aggregated findings.
---

Set `review_mode` to `consolidated` in the session state file before REVIEW runs.

In `consolidated` mode, the agent reviews all files and batches internally,
then emits one final REVIEW response with `Batch: AGGREGATE -- all files
complete` and a single aggregate `# Decision Needed` block. No per-batch
confirmation is requested; all mitigations remain provisional until the user
answers the aggregate decision section.

To switch back to per-batch confirmation, use `/review-interactive`.
