---
description: Explicitly approve the current Baba PLAN and persist approval + rewrite contract into the session state file.
---

The user is approving the current plan via $ARGUMENTS (optional notes).

Before acting:

1. Read the session's own state file `SESSION_STATE-<session_id>.md` (session_id resolved per `system/03-output-and-state.md` `## Session state file`) if present.
2. Read the latest PLAN output from the conversation.
3. Load `system/03-output-and-state.md` (PLAN template + handoff contract) and `system/01-personas.md` `## Handoff contract`.

Then:

- If no complete PLAN and rewrite contract exist, emit `[PHASE: BLOCKED]` listing the missing fields.
- Otherwise write/update the session's own state file with:
  - Plan Approval.status = approved
  - Plan Approval.approved_at = now
  - Plan Approval.approved_plan_summary
  - Rewrite Contract fields (target, must_preserve, must_eliminate, forbidden_in_patch)
  - current_phase = PLAN (approved) or HANDOFF-ready
- Emit a short confirmation that the plan is approved and name the next agent (Build / BabaDev) for PATCH.
- Do not patch in this command.
