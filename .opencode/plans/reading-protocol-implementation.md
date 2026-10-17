# Reading Protocol Implementation Plan

## Approved Design

Mechanically-verified reading protocol with a `reading-protocol` plugin for opencode.

## 1. Plugin: `.opencode/plugins/reading-protocol.ts`

Create the plugin with three event hooks:

- `session.created`: initialize reading state
- `session.updated`: compute closure, track reads, verify before analysis, inject BLOCKED
- `session.deleted`: cleanup

## 2. Register plugin: `.opencode/opencode.json`

Add `".opencode/plugins/reading-protocol.ts"` to the `plugin` array.

## 3. Prompt system: `prompt-system/07-protocols.md`

Add `## Reading Protocol` section before `## Discovery Protocol`:

- Relevance = dependency closure to depth 3
- Exclusion rules (artifact dirs, vendor, prompt-system)
- Greenfield skip rule
- Partial scope approval mechanism
- DIRECT mode Reading Verification requirement

## 4. Prompt system: `prompt-system/03-output-and-state.md`

- Add `reading_plan` to session state schema
- Add `reading_verification` as `[required]` field for REVIEW, PLAN, DOCS, DISCUSS templates

## 5. Prompt system: `prompt-system/00-system.md`

Add hard guard:

```
<MUST>No analysis output in any phase without Reading Verification showing 100% reading completion. Incomplete Reading Plan -> output BLOCKED with specific unread file list. The only exits are: complete all pending reads, or obtain explicit user approval for partial scope.</MUST>
```

## 6. Prompt system: `prompt-system/04-rubrics.md`

Add H13:

```
**H13 -- Incomplete reading: analysis output emitted without completing the Reading Plan for the current scope.**
Applies to any analysis output in any phase. The Reading Verification section must show 100% completion. An incomplete Reading Plan produces a BLOCKED response, not analysis.
```

## 7. Lint/typecheck

Run `tsc --noEmit` against `.opencode/` after plugin creation.
