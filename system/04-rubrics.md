# 04-rubrics

Hard-tier (H1-H12) and soft-tier (S1-S17) review rubrics. Hard-tier items block the PLAN phase until accepted or excluded with justification in the REVIEW decision section. Soft-tier items are quality concerns; flag and discuss, do not hard-block.

## Hard tier (H1-H12)

**H1 -- Security: credentials, tokens, secrets in code or logs.** A credential-bearing file (`.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`) read with the read tool, or its raw contents in the transcript, is a confirmed H1 breach.

**H2 -- Injection: SQL, command, or template injection vectors.**

**H3 -- Authentication bypass: missing or bypassable auth checks.**

**H4 -- Authorization: missing permission checks on sensitive operations.**

**H5 -- Cryptography: weak algorithms, hardcoded keys, broken IV usage.**

**H6 -- Input validation: missing validation on external inputs.**

**H7 -- Error exposure: stack traces, internal paths, or raw exception details exposed through user-facing responses, client-visible APIs, or other untrusted output.** Trusted internal diagnostic logs and error objects that remain within trusted process boundaries are excluded unless they contain credentials or secrets (H1) or are otherwise mishandled.

**H8 -- Dependency risk: known CVEs or unreviewed dependency versions.**

**H9 -- Data integrity: missing transactions, partial writes, or silent data loss.**

**H10 -- Python type safety (Python only): missing type annotations on function signatures.** Applies to parameters and return type. `Any` requires inline `# pyrefly: ignore` with reason.

**H11 -- Runnable artifact (verdict-gate criterion).** The project must build/compile, start (smoke: boot, or library import/entry-point load), pass the existing functional test suite, and pass a Playwright e2e smoke (navigate to the deployed/preview URL, click through 1-2 critical user flows). Applies once per session/aggregate at verdict time, not per chunk. Exclusion allowed only with justification recorded in the REVIEW decision section (e.g., no test suite exists, execution environment unavailable, or suite failing on a pre-existing baseline). Do not invent commands. If none exist, record SKIPPED with reason.

**H12 -- Idiom consistency: a change introduces an error-handling or style idiom that conflicts with the dominating pattern of the file or codebase** (e.g., `try/catch` in an exit-code-guard script, Result-wrapping in an exception-style codebase, a new failure idiom for an operation the file already handles). Confirmed when the file's established idiom is evident from uniform usage or an in-code comment. When the imported idiom cannot detect the failure it claims to handle, H9 applies alongside.

## Soft tier (S1-S17)

**S1 -- Naming: unclear, misleading, or inconsistent identifiers.**

**S2 -- Function length: functions exceeding a single clear responsibility.**

**S3 -- Complexity: deeply nested conditionals or loops without justification.**

**S4 -- Duplication: repeated logic that should be extracted.**

**S5 -- Dead code: unreachable or unused code paths.**

**S6 -- Magic values: unexplained literals that should be named constants.**

**S7 -- Error handling: swallowed exceptions or missing error context; includes trusted internal errors that expose unnecessary implementation details.**

**S8 -- Logging: missing, excessive, or misleading log statements; includes unnecessary absolute paths or raw exception details in trusted internal logs.**

**S9 -- Test coverage: missing tests for critical paths.**

**S10 -- Documentation: missing or misleading comments on non-obvious logic.**

**S11 -- Type safety: missing type annotations or unsafe casts.** Note: in Python code, S11 is upgraded to H10 for missing type annotations on function signatures (parameters and return types).

**S12 -- Performance: obvious inefficiencies with measurable impact.**

**S13 -- Over-engineering: unrequested abstractions or speculative genericity beyond what the change needs;** includes an interface with one implementation, a factory for one product, config for values that never change, and new dependencies when an existing one covers the need.

**S14 -- Stepdown rule: a function's body mixes high-level orchestration with low-level operations.** Functions read top-to-bottom and call functions one level of abstraction below them. A function whose first line is a high-level call (`fetchUser()`) and whose next line is a low-level call (`parseJwt(token)`) without a named intermediate is a stepdown violation (Martin, *Clean Code* ch. 3 "One Level of Abstraction per Function" / ch. 11 "The Stepdown Rule").

**S15 -- Newspaper order: a file does not read top-to-bottom from public API to private details.** A public function appears below the private helper it calls, or a related group of functions is split across the top and bottom of the file. Files read like a newspaper article: headline first, then increasingly fine detail (Martin, *Clean Code* ch. 5 / ch. 11 "The Newspaper Metaphor").

**S16 -- Flag/output arguments: a function takes a boolean flag that selects between two behaviors, or a function mutates an argument passed by reference instead of returning a value.** Split the flag-argument function into two; return a value instead of mutating an output argument (Martin, *Clean Code* ch. 3 / ch. 8 "Function Arguments" -- Flag Arguments and Output Arguments).

**S17 -- Tell, don't ask (Law of Demeter): a method reaches through another object to access its parts (`a.b.c.d`); the behavior belongs on the inner object.** A chain of more than one dot is a Demeter violation unless the chain is a fluent-builder return value (Martin, *Clean Code* ch. 6 / ch. 12 "Objects and Data Structures" -- The Law of Demeter).

## Documented extension IDs

When artifact, gitattributes, or pre-commit review is in scope, those extensions fall under the soft-tier coverage tick:

- `S-artifact` -- artifact handling rules (binary files, build outputs, generated content).
- `S-gitattributes` -- `.gitattributes` correctness (line endings, diff drivers, large-file handling).
- `S-precommit` -- pre-commit hook configuration (file globs, hook ordering, auto-fix behavior).

## Usage

- Apply all hard-tier items to every chunk unless explicitly excluded in the checklist. H11 is the sole aggregate-level criterion; H1-H10 and H12 still apply per chunk.
- Flag all applicable soft-tier items in the REVIEW phase. Soft-tier items are eligible for the PLAN phase only after acceptance in the REVIEW decision section.
- A confirmed hard-tier violation blocks the PLAN phase until accepted or excluded with justification in the REVIEW decision section.
