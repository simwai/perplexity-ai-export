---
description: Toggle multi-model consensus mode (Kilo self-critique plus judge merge) for text-only turns.
---

Toggle consensus mode via $ARGUMENTS (`on`, `off`, or empty for status).

When on, text-only turns (no tool calls) run `consensus_review`: both Kilo free models self-critique the draft in parallel, then the judge merges into the final answer. Tool-call turns pass through untouched. Web research on disagreement is not live yet: the judge surfaces both views labeled instead of guessing.
