# AGENTS.md - Entry Point

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
- AGENTS.md is the sole entry point; `prompt-system/00-system.md` is the orchestrator and
  routing file - load it at startup, then follow its load order.
- Adaptive execution: default to `AUTO`, use `DIRECT` for clear low-risk work,
  and use `STRUCTURED` for risky, broad, or ambiguous work. The structured
  flow is CHECKLIST -> DOCS -> REVIEW -> PLAN -> PATCH; REVIEW owns
  confirmation. Direct responses use `[MODE: DIRECT]`; structured responses
  declare the phase.
- Canonical rules live in `prompt-system/` (orchestrator + routing + decision format, output
  contracts, rubrics, implementation style, operational protocol + commit/push gate,
  cross-cutting protocol, Plan-Versus-Actual Gate).

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
    "args": ["-y", "@playwright/mcp@0.0.80"]
  },
  "playwright-headless": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@0.0.80", "--headless"]
  },
  "g-search": {
    "command": "npx",
    "args": ["-y", "g-search-mcp"]
  },
  "arxiv": {
    "command": "uvx",
    "args": ["arxiv-mcp-server"]
  }
}
```

**Context7** - library docs (stdio: `npx -y @upstash/context7-mcp`)
**Playwright** - browser automation for live UI verification and e2e walk-throughs (Node 20+; headed for testing)
**Playwright-headless** - headless browser for web search and scraping (Node 20+; `--headless` flag)
**Playwright bootstrap** — run `scripts/ensure-playwright.ps1` before first use or after fresh clones; checks Node ≥ 20, resolves `@playwright/mcp`, installs missing browser binaries.
**g-search** - Google web search via MCP (no key required; requires Playwright Chromium: `npx playwright install chromium`)
**arXiv** - academic paper search and local literature management via MCP (no key required; requires `uvx`; bootstrap: `scripts/ensure-uvx.ps1`)

**OpenCode PTY** — interactive terminal plugin: background processes, multiple sessions, stdin, output regex filter. Auto-installed by OpenCode on next run.

### Tier 2 - OAuth (no env keys required)

```json
{
  "exa": {
    "type": "remote",
    "url": "https://mcp.exa.ai/mcp",
    "oauth": {}
  }
}
```

> **Note**: Omit this entire block if `EXA_API_KEY` is not set. The agent will use `g-search` as the no-key fallback per `00-system.md`.

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

Google web search must never require `GOOGLE_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID`. Default is the `g-search` MCP server when available, with direct curl to Google's URL format as the last resort:

```bash
curl -s "https://www.google.com/search?q=<url-encoded-query>"
```

### Full combined config (`mcp.json`)

Combine all Tier 1 + Tier 2 + Trello blocks above. Omit any Tier 2 servers whose keys you lack - the agent adapts via the fallback ladder in `prompt-system/00-system.md`.

---

## Environment Variables

| Variable | Server | Required |
|---|---|---|
| `EXA_API_KEY` | Exa | No (OAuth used instead) |

---

<HIGH_PRIO>
!!!

## Loading the Full Spec (MANDATORY — immediate, before any other action)

AGENTS.md is the sole entry point. The system lives in `prompt-system/`.

**Immediately after reading this file (no exceptions):**

1. Read `AGENTS.md` in full with NO chunking — single read, largest window.
2. Discover all system files: `ls prompt-system/*.md`.
3. Read `prompt-system/00-system.md` — it contains the authoritative `## Load order`.
4. Load every file in that load order in full with NO chunking.
5. **Emit the bootstrap fingerprint**:
   ```
   AGENTS.md fingerprint: <line_count> lines, first_100_chars="<first 100 chars>", last_100_chars="<last 100 chars>", sha256_first_1kb="<hash or N/A>"
   ```
6. **Record completion** in session state `## Startup Verification` (or conversation carrier on READ_ONLY).

**All files must be read in full before ANY other action.** This is not optional, not conditional. Skipping any file is a protocol breach. If loading is incomplete, the agent must not proceed — output `BLOCKED` with reason "STARTUP incomplete".
***
</HIGH_PRIO>
