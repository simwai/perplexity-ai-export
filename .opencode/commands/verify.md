---
description: Verify an approved patch using the mutation-capable Build agent; record verification in the session state file.
agent: build
---

Run BabaDev verification after a patch or before finishing implementation work. This command is intentionally Build-scoped and is not a read-only inspection boundary. Optional focus: $ARGUMENTS.

Before acting:

1. Read the session's own state file `SESSION_STATE-<session_id>.md` (resolved per `system/03-output-and-state.md` `## Session state file`) if present.
2. Inspect `git status` and `git diff`.
3. Detect available project checks from package scripts, Makefile, pyproject, or docs (lint, typecheck, test).

Then:

- Summarize the diff at a high level.
- Run the smallest relevant check set. Do not invent commands.
- When the repo declares a web-app entry point, invoke the Playwright MCP
  server for a functional smoke (navigate + click key flows) as part of the
  check set before the commit/push gate; a failed smoke is a hard-gate failure.
- If no checks exist, say so explicitly.
- When the session made file edits, apply the commit/push gate (`system/06-misc.md` `## Commit/push gate`) before finishing.
- Update the session's own state file Verification fields.
- Emit results under the current phase header (usually PATCH) using the Verification section from `system/03-output-and-state.md`.
