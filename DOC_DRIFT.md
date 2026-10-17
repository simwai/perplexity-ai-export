# Documentation Drift Audit Report

- **Date/Time of Run**: 2026-03-31 06:28:00 UTC
- **Branch Analyzed**: `dev`

## Files Reviewed

- `README.md`
- `BOOTSTRAP.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `docs/ARCH.md`
- `docs/BENCHMARKS.md`
- `docs/DEBUGGING.md`
- `.env.example`
- `package.json`
- `.vscode/launch.json`

## Regressions Found

1. **Stale Log File Paths in `docs/DEBUGGING.md`**:
   - The documentation table listed `debug/main-log-<timestamp>.txt` and `debug/http-req-res-log-<timestamp>.txt`.
   - The application writes main logs and HTTP logs to `logs/` (e.g. `logs/main-log-...` and `logs/http-req-res-log-...`), as defined in `src/utils/log-constants.ts` (`LOGS_DIRECTORY = 'logs'`).

2. **Inconsistent Candidate Pool Limit in Sequence Diagram in `docs/ARCH.md`**:
   - The sequence diagram in Section 4 labeled candidate pool limits as `(35 precise / 60 exhaustive)`.
   - Stage A in `docs/ARCH.md`, `README.md`, and application code (`src/ai/rag-orchestrator.ts`) set the pool limits to 50 for precise mode and 80 for exhaustive mode (`POOL_LIMIT_PRECISE = 50`, `POOL_LIMIT_EXHAUSTIVE = 80`).

## Files Changed

- `docs/DEBUGGING.md`
- `docs/ARCH.md`
- `DOC_DRIFT.md`

## Summary of Fixes Made

- Updated `docs/DEBUGGING.md` log file table entries for `main-log` and `http-req-res-log` from `debug/` to `logs/`.
- Updated candidate pool sizes in the sequence diagram in `docs/ARCH.md` from `(35 precise / 60 exhaustive)` to `(50 precise / 80 exhaustive)`.
