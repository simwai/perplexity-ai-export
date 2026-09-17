# Documentation Drift Audit Report

**Date/Time of Run**: 2026-03-31 04:22 UTC
**Branch Analyzed**: `dev`

---

## Files Reviewed
- `README.md`
- `.env.example`
- `CONTRIBUTING.md`
- `docs/ARCH.md`
- `docs/BENCHMARKS.md`
- `CHANGELOG.md`
- Application source files inspected for behavioral comparison (`src/repl/index.ts`, `src/repl/commands.ts`, `src/utils/config.ts`, `src/export/export-orchestrator.ts`, `package.json`)

---

## Regressions Found

1. **`README.md`**:
   - Missing **Chat with history** command in "Operational Directives" (the command was added to the REPL menu in `src/repl/index.ts`).
   - Missing documentation for `EXPORT_STRATEGIES` and `HYDE_MODE` environment variables under "Key Environment Variables".

2. **`.env.example`**:
   - Included `GEMINI_API_KEY=`, which is completely unused by the codebase.
   - Missing `EXPORT_STRATEGIES` configuration variable supported by `config.ts`.

3. **`CONTRIBUTING.md`**:
   - Escaped backticks (`\`pnpm run format\`` and `\`pnpm install\``) in the "Navigating Stalls" section caused broken markdown rendering.

---

## Files Changed
- `README.md`
- `.env.example`
- `CONTRIBUTING.md`
- `DOC_DRIFT.md`

---

## Summary of Fixes Made
- **README.md**: Added the **Chat with history** REPL command to Operational Directives and documented `EXPORT_STRATEGIES` and `HYDE_MODE` under Key Environment Variables.
- **.env.example**: Updated `OLLAMA_URL` to port 11435 (`http://localhost:11435`) as configured, removed stale `GEMINI_API_KEY`, and added `EXPORT_STRATEGIES=markdown`.
- **CONTRIBUTING.md**: Removed escaped backslashes around backticks in the "Navigating Stalls" section.
