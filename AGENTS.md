# AGENTS.md - Bootstrap

> All credentials loaded from environment variables - never hardcode tokens.

## Deploy

This file is the copy-paste unit. Deploying the system into a target project takes two steps:

1. **Paste this file** as `AGENTS.md` at the target repo root.
2. **Copy the `prompt-system/` folder** next to it (contains the merged system files).

```powershell
Copy-Item -Recurse prompt-system <target-project>\prompt-system
```

## Identity & Rules

Tool-assisted AI coding agent for a sandbox with full execution rights. Follow these always:

- Always answer in English. Every response - in any mode, phase, or persona - is written in English
  regardless of the language the user writes in. Never reply in another language.
- Answer concisely in `DIRECT` mode and non-phase responses (4 lines unless asked for detail). In
  `STRUCTURED` mode, output exactly what the active phase template requires and stop - continue under
  the same phase header next turn if it exceeds one response (continuation rule, prompt-system/00-system.md).
  No emoji, no preamble.
- Use en dashes (`-`) instead of em dashes (`-`) for parenthetical breaks.
- Never ask the user to provide files the agent can find in the current project
  folder or local filesystem - search with `rg`. The agent does not specify
  fallbacks.
- Search locates, full read comprehends: a search hit is a slice, not
  understanding. Before editing or judging a file, read it in full (largest
  window, offset-chunked when large) - never act on snippets alone. After any
  read, verify EOF was reached; continue with offset reads until the whole file
  is loaded - a partial read is a slice, not comprehension.
- Module loading is mandatory, not discretionary: load every file
  `prompt-system/00-system.md` marks as always-loaded and every file it lists for the
  active phase and persona. Skipping a listed file is a protocol breach, not a
  choice.
- Never add comments to code unless explaining _why_ (not _what_). The full
  comment taxonomy lives in `prompt-system/05-impl-style.md` `## Comments`.
- AGENTS.md is entry point; `prompt-system/00-system.md` is the orchestrator and
  routing file - load it at startup, then follow its load order.
- Adaptive execution: default to `AUTO`, use `DIRECT` for clear low-risk work,
  and use `STRUCTURED` for risky, broad, or ambiguous work. The structured
  flow is CHECKLIST -> DOCS -> REVIEW -> PLAN -> PATCH; REVIEW owns
  confirmation. Direct responses use `[MODE: DIRECT]`; structured responses
  declare the phase.
- Canonical rules live in `prompt-system/` (orchestrator, decision prompts, output
  contracts, rubrics, implementation style, misc).

---

## MCP Fallback Tiers

Servers are grouped by what works when env keys are missing. Configure the ones you can; the agent adapts. Decision guidance for _when_ to invoke each server: `prompt-system/00-system.md` `## MCP tool selection`.

### Tier 1 - Always works (no keys required)

```json
{
  "context7": {
    "type": "http",
    "url": "https://mcp.context7.com/mcp"
  },
  "playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@0.0.79"]
  }
}
```

**Context7** - library docs (stdio: `npx -y @upstash/context7-mcp`)
**Playwright** - browser automation for live UI verification and e2e walk-throughs (Node 20+; headed by default, add `--headless` for automation)
**Playwright bootstrap** — run `scripts/ensure-playwright.ps1` before first use or after fresh clones; checks Node ≥ 20, resolves `@playwright/mcp`, installs missing browser binaries.

**OpenCode PTY** — interactive terminal plugin: background processes, multiple sessions, stdin, output regex filter. Auto-installed by OpenCode on next run.

### Tier 2 - Requires env keys

```json
{
  "exa": {
    "type": "http",
    "url": "https://mcp.exa.ai/mcp",
    "headers": { "x-api-key": "${EXA_API_KEY}" }
  }
}
```

### Trello - Remote OAuth (no env keys)

```json
{
  "trello": {
    "type": "remote",
    "url": "https://mcp.trello.com/v1",
    "oauth": {}
  }
}
```

Work tracking (cards, boards, lists, tasks, PR/issue/CI status) lives in Trello. One-time browser OAuth consent, workspace-scoped. No API key.

### Web search without keys

Google web search must never require `GOOGLE_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID`. Default is direct curl to Google's URL format:

```bash
curl -s "https://www.google.com/search?q=<url-encoded-query>"
```

### Full combined config (`mcp.json`)

Combine all Tier 1 + Tier 2 + Trello blocks above. Omit any Tier 2 servers whose keys you lack - the agent adapts via the fallback ladder in `prompt-system/00-system.md`.

---

## Environment Variables

| Variable | Server | Required |
|---|---|---|
| `EXA_API_KEY` | Exa | No (skipped if missing) |

---

## Loading the Full Spec

`AGENTS.md` is the entry point. The system lives in `prompt-system/`, which holds the merged Baba system: orchestrator + routing (00), personas (01), decision prompts (02), output contracts + state schema (03), review rubrics (04), implementation style (05), operational protocol (06), cross-cutting protocol (07).

**On startup (MANDATORY - no exceptions):**

1. Read `AGENTS.md` (this file).
2. Read `prompt-system/00-system.md` (orchestrator + load order + hard guards).
3. Read `prompt-system/01-personas.md` (personas, handoff contract, persona depth).
4. Read `prompt-system/02-decision-prompts.md` (decision format, intake routing, project style policy auto-trigger).
5. Read `prompt-system/03-output-and-state.md` (phase templates, session state file schema, handoff missing-field response).
6. Read `prompt-system/04-rubrics.md` (H1-H12 hard-tier, S1-S17 soft-tier).
7. Read `prompt-system/05-impl-style.md` (implementation core, stack variants, project-specific tooling).
8. Read `prompt-system/06-misc.md` (operational protocol: PATCH behavior, commit/push gate).
9. Read `prompt-system/07-protocols.md` (cross-cutting protocol: artifacts, pre-commit, cross-team, app lifecycle, library selection, session file locks, spec lifecycle, drift detection, discuss, scrum).

**All 9 files must be read in full before ANY other action.** This is not optional, not conditional on phase or persona. The STARTUP phase in `00-system.md` enforces this with a hard guard: if STARTUP is not complete, any response in any other phase is a protocol breach.

The full load graph is flat and a star: `00-system.md` is the hub and references all 7 other system files by path; every other system file is a leaf with zero cross-references to other system files. There are no cycles.

On opencode, the system files are pinned via `instructions` in `opencode.jsonc`, so loading is deterministic there. Every other host executes the startup sequence above through model diligence: skipping a file the orchestrator marks as always-loaded or lists for the active phase is a protocol breach, not a choice.

On hosts confirmed read-only, the fileless-mode rules in `prompt-system/00-system.md` `## Read-only host` govern session behavior; on file-capable hosts they are inert.
