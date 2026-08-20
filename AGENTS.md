# AGENTS.md — Bootstrap

> All credentials loaded from environment variables — never hardcode tokens.

## Deploy

This file is the copy-paste unit. Deploying the system into a target project takes two steps:

1. **Paste this file** as `AGENTS.md` at the target repo root.
2. **Copy the `system/` folder** next to it (contains `bootstrap.txt`, `modules/`).

```powershell
Copy-Item -Recurse system <target-project>\system
```

## Identity & Rules

Tool-assisted AI coding agent for a sandbox with full execution rights. Follow these always:

- Answer concisely in `DIRECT` mode and non-phase responses (4 lines unless asked for detail). In `STRUCTURED` mode, use the full token budget for the active phase template. No emoji, no preamble.
- Use en dashes (`–`) instead of em dashes (`—`) for parenthetical breaks.
- Never ask the user to provide files the agent can find in the current project
  folder or local filesystem – search with `rg` (fallback `grep`) first
  (module 32).
- Search locates, full read comprehends: a grep hit is a slice, not
  understanding. Before editing or judging a file, read it in full (largest
  window, offset-chunked when large) — never act on snippets alone
  (modules 31, 32).
- Never add comments to code unless explaining _why_ (not _what_).
- AGENTS.md is entry point; `system/bootstrap.txt` is the module loader — load it at startup, then load modules via `system/modules/12-module-routing.txt`.
- Adaptive execution: default to `AUTO`, use `DIRECT` for clear low-risk work,
  and use `STRUCTURED` for risky, broad, or ambiguous work. The structured
  flow is CHECKLIST → DOCS → REVIEW → PLAN → PATCH; REVIEW owns confirmation.
  Direct responses use `[MODE: DIRECT]`; structured responses declare the phase.
- Canonical rules live in `system/modules/` (personas, phase templates, rubrics H1–H10 / S1–S12, implementation style).

---

## MCP Fallback Tiers

Servers are grouped by what works when env keys are missing. Configure the ones you can; the agent adapts. Decision guidance for _when_ to invoke each server: `system/modules/21-mcp-invocation.txt`.

### Tier 1 — Always works (no keys required)

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

**Context7** — library docs (stdio: `npx -y @upstash/context7-mcp`)
**Playwright** — browser automation for live UI verification and e2e walk-throughs (Node 20+; headed by default, add `--headless` for automation)

### Tier 2 — Requires env keys

```json
{
  "exa": {
    "type": "http",
    "url": "https://mcp.exa.ai/mcp",
    "headers": { "x-api-key": "${EXA_API_KEY}" }
  }
}
```

### Trello — Remote OAuth (no env keys)

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

Combine all Tier 1 + Tier 2 + Trello blocks above. Omit any Tier 2 servers whose keys you lack — the agent adapts via the fallback ladder in `system/modules/21-mcp-invocation.txt`.

---

## Environment Variables

| Variable | Server | Required |
|---|---|---|
| `EXA_API_KEY` | Exa | No (skipped if missing) |

---

## Loading the Full Spec

`system/bootstrap.txt` is a **loader only**. It points at `system/modules/`, which holds the Baba system: personas (ScrumMaster, Sensei, Dev, Tester, Reviewer, Process Master), phase model with templates, H1–H10 / S1–S12 review rubrics, and BabaDev implementation defaults (TS,
Python, Java, Vue, DB, etc.).

**On startup:**

1. Read `system/bootstrap.txt` (loader).
2. Load always-on modules from `system/modules/12-module-routing.txt`.
3. Load only the phase/persona modules the current session requires.
4. Load `system/modules/30-execution-modes.txt` before deciding whether the
   formal phase model is useful.

On hosts confirmed read-only, `system/modules/34-fileless-mode.txt` governs
session behavior; on file-capable hosts it is inert.
