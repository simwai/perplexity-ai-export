---
description: Emit a complete Baba persona handoff contract and persist it to the session state file.
---

Create a persona handoff. $ARGUMENTS may name the receiving persona and any notes.

Before acting:
1. Read `system/modules/13-persona-handoff-contract.txt`.
2. Read the session's own state file `SESSION_STATE-<session_id>.md` (resolved per module 19) if present.
3. Gather target, accepted violations, preserve constraints, approved plan, rewrite contract, and tester fields from session state and conversation.

Then:
- Emit the exact HANDOFF template from module 13.
- If any required field for the receiver is missing, emit `[PHASE: BLOCKED]` with the missing fields only.
- On success, write the handoff payload into the session's own state file and stop. Do not begin the receiver's work in the same response unless the user also asked to switch persona.
