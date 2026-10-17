---
description: Close the current session and run a final evaluation via /subtask to baba-reviewer.
---

Close the current session. Records close metadata in the session state file, then spawns a `/subtask` to `baba-reviewer` for a structured session evaluation.

Before acting:

1. Resolve the session's own state file `SESSION_STATE-<session_id>.md` per `prompt-system/03-output-and-state.md` `## Session state file`. If missing, record close metadata in conversation carrier and continue.
2. Read `prompt-system/07-protocols.md` `## App lifecycle` `### Close-session protocol` for the full close flow.
3. Determine `closed_by`: "user request" for explicit `/close` or natural language, "automatic" for post-commit/push auto-close.

Then:

- Record `closed_at` (ISO-8601 UTC), `closed_by`, `mode_at_close`, `final_commit` (from `## Commit/Push Gate` if present), `working_tree`, and `note` in the `## Session Close` section of the session state file.
- If the session made edits and a commit was recorded, announce automatic close and skip the evaluation unless the user explicitly requests it.
- If the session made no edits, or the user invoked `/close` explicitly, spawn a `/subtask` to `baba-reviewer` with the evaluation prompt from `prompt-system/03-output-and-state.md` `## Session evaluation prompt`.
- Append the evaluation result to the session state file `## Session Close` section.
- Announce close to the user: session ID, final commit (if any), evaluation verdict (PASS/FAIL/SKIPPED), and one-line summary.
