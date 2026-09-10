# Documentation Drift Report

- **Date / Time of Run**: 2026-09-10T06:10:10Z
- **Branch Analyzed**: `master` (working branch `jules-15139738311216851236-c6bbf4a4`)
- **Files Reviewed**:
  - `README.md`
  - `.env.example`
  - `docs/ARCH.md`
  - `docs/BENCHMARKS.md`
  - `CONTRIBUTING.md`
  - `CHANGELOG.md`
  - `package.json`
  - `src/utils/config.ts`

- **Regressions Found**:
  1. In `.env.example`, `OLLAMA_URL` was configured as `http://localhost:11435`, which drifted from the standard Ollama port and code default (`http://localhost:11434` in `src/utils/config.ts`).
  2. In `README.md`, `OLLAMA_MODEL` listed `e.g., deepseek-r1` without noting the codebase default fallback (`llama3.1`).

- **Files Changed**:
  - `.env.example`
  - `README.md`
  - `DOC_DRIFT.md`

- **Fixes Made**:
  - Corrected `OLLAMA_URL` in `.env.example` from port `11435` to `11434`.
  - Updated `OLLAMA_MODEL` in `README.md` to note the default fallback (`llama3.1`) and recommended model (`deepseek-r1`).
