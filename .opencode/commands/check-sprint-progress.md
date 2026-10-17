---
description: Check sprint progress. Reports story completion, task counts, and phase status across sprints. Uses Trello MCP or project-management/ folder.
---

Check sprint progress. `$ARGUMENTS` optionally specifies a sprint ID/name; omit to check all sprints.

Before acting:

1. Read `prompt-system/00-system.md` (orchestrator + routing + execution modes).
2. Read the session's own state file `SESSION_STATE-<session_id>.md` if present.
3. Read `project-management/config.md` to determine the active backend.

Then:

## File-based backend (`backend: file`)

1. If `$ARGUMENTS` specifies a sprint ID/name, locate `project-management/sprint-NNN.md`. Otherwise, scan all `project-management/sprint-*.md` files.
2. If no sprints found, emit `[PHASE: BLOCKED]` with: "no sprints found. Create one with /create-sprint-phase-plan."
3. For each sprint:
   - Read the file in full.
   - Parse stories and their statuses.
   - Count: total stories, done stories, in-progress stories, not-started stories.
   - Count tasks and blockers.
   - Calculate completion percentage: done_stories / total_stories * 100.
   - Check ICE scores and note if any story is unsized.
4. Emit a summary:

```text
Sprint Progress Report
======================
< Sprint Name >
  Target: YYYY-MM-DD | Status: active | Completion: NN%
  Stories: X total, Y done, Z in progress, W not started
  Tasks: A done, B pending
  Blockers: N (list them)
  ICE average: <value>
```

1. For all sprints, list them in order with the summary above.
2. Flag any sprint with 0% completion or all stories unsized as `NEEDS ATTENTION`.

## Trello backend (`backend: trello`)

1. Find sprint boards via `list_boards`.
2. For each sprint board, call `get_lists` to get all lists.
3. For each list, call `get_cards_by_list_id` to get cards.
4. Calculate progress by counting cards across lists (Done list vs total).
5. Check for cards with blocker labels.
6. Emit the same summary format as the file-based backend.

## Common

- If no sprints match the query, emit `[PHASE: BLOCKED]` with: "sprint not found."
- Include blocker details in the output if any are found -- flag them prominently.
- Record the check in the session state file under `## Project Management`.
