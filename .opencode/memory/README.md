# Memory Worth Plugin v4.2

Persistent agent memory with trust signals, invalidation, and self-tuning.

## Architecture

The plugin is a multi-file TypeScript module under `.opencode/plugins/memory-worth/`:

```text
memory-worth/
  index.ts          -- plugin entry point
  prompt.ts         -- prompt injection fragments
  outcome.ts        -- outcome detection heuristics
  runtime/          -- Node/Bun abstraction layer
    detect.ts       -- runtime detection (Node vs Bun)
    shell.ts        -- shell command execution
    shim/           -- path/env/process shims
  core/             -- pure ES2022 business logic
    types.ts        -- domain types
    prng.ts         -- seeded PRNG
    trust.ts        -- trust scoring
    governance.ts   -- invalidation, merge, status, tune, stats
  db/               -- database access
    connection.ts   -- libsql client factory
    schema.ts       -- 3NF schema definitions
    migrate.ts      -- migration runner
    queries.ts      -- shared data-access helpers
  tools/            -- OpenCode tool registrations (12 tools)
  hooks/            -- chat.message, tool.execute.after, event, compacting
```

## Database

- Path: `.opencode/memory.db` (flat file)
- Driver: `@libsql/client`
- Schema: 3NF with lookup tables, no JSON columns

## Cross-runtime

Runs on both Desktop (Node.js/Electron) and CLI (Bun) without modification. The `runtime/` layer absorbs runtime differences; `core/` modules are pure ES2022.

## Sim Harness

The simulation harness lives at `opencode-memory-mw/sim/` as a separate Node-only package.

## Tools

1. `memory_search` -- free-text search with trust labels
2. `memory_get` -- retrieve by ID
3. `memory_synthesize` -- combine multiple memories
4. `memory_wakeup` -- surface stale memories
5. `memory_write` -- store new memory
6. `memory_update` -- update content (preserves trust)
7. `memory_invalidate` -- mark as invalidated
8. `memory_merge` -- merge two memories
9. `memory_delete` -- soft-delete
10. `memory_set_status` -- set active/archived/invalidated/merged
11. `memory_stats` -- calibration, discrimination, distribution
12. `memory_tune` -- adjust tuning knobs with rationale

## Logging

All logging uses `ctx.client.app.log({ body: { service, level, message, extra } })`. No `console.log` in plugin code.
