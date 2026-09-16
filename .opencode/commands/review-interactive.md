---
description: Switch REVIEW cadence to interactive mode for per-batch confirmation.
---

Set `review_mode` to `interactive` in the session state file, then enter REVIEW phase.

In `interactive` mode, the agent emits one batch per response and waits for
user confirmation before advancing to the next batch.

To switch to aggregated findings with a single confirmation at the end, use
`/review-consolidated`.

After setting the flag, enter REVIEW by declaring `[PHASE: REVIEW]` and
emitting the REVIEW template from `prompt-system/03-output-and-state.md`.
