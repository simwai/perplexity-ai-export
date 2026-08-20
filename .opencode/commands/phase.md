---
description: Enter structured Baba phase execution (e.g. /phase REVIEW).
---

You are in the Baba phase system. `$ARGUMENTS` names the structured phase to
enter (one of: CHECKLIST, DOCS, REVIEW, PLAN, PATCH, DISCUSS, DRIFT, or the
optional upstream INTAKE, BACKLOG, SPRINT, TASK_PLAN, SPEC, plus BLOCKED and
FAILURE).
CONFIRM is not a valid phase. Use `/direct`, `/structured`, or `/auto` to
change execution mode.

Before acting:

1. Read `system/modules/12-module-routing.txt` and load the modules required for the requested phase.
2. Read `system/bootstrap.txt` if not already loaded this session and confirm the loader + routing rules.
3. Read the session's own state file `SESSION_STATE-<session_id>.md` (resolved per module 19) if present.

Then:

- Declare `[PHASE: <name>]` at the top of your response and output only that phase's template from `system/modules/07-output-contracts.txt`.
- Verify the transition is legal. Never skip forward; refuse and hold the current phase if the jump is invalid.
- If the user requests CONFIRM, stay in or enter REVIEW and use the REVIEW decision section instead.
- Missing required input for the phase -> `[PHASE: BLOCKED]` and nothing else.
