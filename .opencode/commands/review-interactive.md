---
description: Switch REVIEW cadence to interactive mode for per-batch confirmation.
---

Set `review_mode` to `interactive` in the session state file before REVIEW runs.

In `interactive` mode, the agent emits one batch per response and waits for
user confirmation before advancing to the next batch.

To switch to aggregated findings with a single confirmation at the end, use
`/review-consolidated`.
