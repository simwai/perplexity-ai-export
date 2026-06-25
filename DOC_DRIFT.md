# Documentation Drift Report

**Date/Time:** 2026-06-25 06:10:00 UTC
**Branch Analyzed:** dev
**Files Reviewed:**
- README.md
- docs/ARCH.md
- docs/BENCHMARKS.md
- .env.example

## Regressions Found

1. **Stale OLLAMA_URL Port:** `.env.example` used port `11435`, while `src/utils/config.ts` defaults to `11434`.
2. **Default Model Mismatch:** `src/utils/config.ts` defaults to `llama3.1`, but documentation and `.env.example` prominently feature `deepseek-r1`.
3. **Missing Feature Documentation:** The "Chat with history" command (added to the REPL) is not mentioned in `README.md`.
4. **Missing Environment Variable:** `EXPORT_STRATEGIES` is implemented in `src/utils/config.ts` but missing from `README.md` and `.env.example`.
5. **Stale Configuration:** `GEMINI_API_KEY` remains in `.env.example` despite no Gemini-related code existing in the current codebase.

## Files Changed

- **README.md**: Added "Chat with history" to Usage Guide; Added `EXPORT_STRATEGIES` to Key Environment Variables; Clarified `OLLAMA_MODEL` default.
- **.env.example**: Updated `OLLAMA_URL` port; Added `EXPORT_STRATEGIES`; Removed stale `GEMINI_API_KEY`.
- **DOC_DRIFT.md**: Initialized with regression findings and fix log.

## Summary of Fixes

- Aligned OLLAMA_URL default port across codebase and configuration.
- Synchronized documentation with latest REPL features (Chat mode).
- Surfaced previously undocumented but active environment variables (`EXPORT_STRATEGIES`).
- Cleaned up stale configuration placeholders (`GEMINI_API_KEY`).
