# 06-misc

Operational protocol: PATCH behavior, commit/push gate. Cross-cutting protocol details (artifacts, pre-commit, cross-team, app lifecycle, library selection, session file locks, spec lifecycle, drift, discuss, scrum) live in `07-protocols.md`.

## PATCH protocol

Prerequisites: explicit user plan approval; complete rewrite contract.

Rewrite contract fields (all required):

- Target: file or module
- Must preserve: list of constraints
- Must eliminate: list of confirmed violations
- Forbidden in patch: tokens, patterns, or constructs that must not appear

Patch rules:

- Produce a complete, runnable patch. No partial rewrites unless scope was explicitly limited.
- Do not introduce changes outside the approved plan.
- Do not add new logic not discussed in the plan.
- Preserve all items in the must-preserve list exactly.
- Preserve the touched files' established local conventions (formatting, naming, structure, comments, documentation style) unless the approved plan explicitly overrides them.
- Eliminate all items in the must-eliminate list.
- Never include any token from the forbidden list.

If a library, driver, or SDK appears to mislead during PATCH (unexpected error shape, version-sensitive breakage, behaviour that contradicts the docs), feel free to consult official documentation via the `context7` MCP (or `exa`/direct `curl` as fallback per `00-system.md ## MCP tool selection`) before inventing a workaround. This is a permission, not a requirement, and is bounded by the same rules as the DOCS phase: one targeted lookup per evidence gap, distinct fingerprint, never re-invoke an identical lookup, and the bounded deep-dive budget (up to 3 lookups per dependency per PATCH).

### Per-edit lint gate

Before each file edit sequence, confirm the applicable defaults from `05-impl-style.md` (stack defaults, naming, file naming, local conventions) and apply them to the edit. After each file edit sequence (one logical edit step: one file or a coherent batch of files changed in one go), run the project's configured lint on the touched files before starting the next edit step. Follow the order from `07-protocols.md` `## Pre-commit behavior` section: formatter first (auto-fix), linter second (auto-fix mode where supported), then fix any remaining violations manually. When `.md` files are touched, run the repository's configured markdownlint against them and honor its configuration. Re-run lint after manual fixes. A step may not conclude with outstanding auto-fixable issues.

If a remaining violation cannot be fixed inside the approved plan's scope, record it explicitly and follow the verification-gate rule below: FAIL unless the failure is outside scope and explicitly accepted. Record the exact command and its real output per step in the session's own state file; never record an assumed-clean pass. If no lint command exists, record SKIPPED with the reason.

At the same recording step, append each edited path to the session's own state file `## Edited Files` section; this list is the staging source for the commit/push gate. The final Verification gate still runs at the end; the per-edit gate does not replace it.

### Bug-fix regression protocol

A confirmed bug entering PATCH triggers this protocol. A "confirmed bug" is any defect accepted for correction from REVIEW, production feedback, a security finding, an edge-case report, or a failing test surfaced inside the PATCH handoff. The protocol is canonical here; persona obligations in `01-personas.md` and template rows in `03-output-and-state.md` are specializations and must not duplicate this text.

For each confirmed bug, the patch must, in order:

1. **Missed-coverage root cause.** Record one sentence per bug explaining why the existing test layer missed it: missing case, wrong oracle, wrong test layer, fixture or setup gap, skipped or flaky test, or equivalent. The root cause is written before the regression test is added and travels with the PATCH handoff under `## Findings Mitigations` or the equivalent notes field.
2. **Regression test.** Add the smallest regression test that reproduces the original failure against the unfixed behavior. The test asserts the externally meaningful corrected outcome, not execution alone. A test that passes both before and after the fix is not a regression test and must be replaced.
3. **Baseline verification (expected FAIL).** Run the new regression test against the unfixed behavior. The expected outcome is FAIL. When genuinely impractical (the bug requires unavailable infrastructure, sensitive data, or a destructive harness), record `SKIPPED -- <reason>` plus the nearest feasible substitute and the residual risk. Silent omission is forbidden.
4. **Post-fix verification (expected PASS).** After the fix lands, rerun the same regression test. The expected outcome is PASS. When the same practical blocker applies, record `SKIPPED -- <reason>` plus the substitute and the residual risk. Silent omission is forbidden.

A green pre-existing suite is never proof that a confirmed bug is covered. A full-suite result is never a substitute for the targeted regression test above. A PATCH that ships without a recorded root cause, a regression test, and both verification rows is incomplete and the verification gate reports FAIL.

### Compliance audit

After every patch, emit a compliance audit section. For each must-preserve item: PASS or FAIL. For each must-eliminate item: PASS or FAIL. For each forbidden token: PASS or FAIL. If any audit item is FAIL, do not emit the patch. Return to PLAN phase.

### Verification gate

After a successful compliance audit, inspect the resulting diff. Run the project's relevant checks when available (lint, typecheck, tests, or documented equivalents). The Playwright smoke is the functional verification and runs once inside the commit gate, after this gate passes; it is referenced here, not executed here; its PASS|FAIL|SKIPPED outcome is recorded in the gate outcome and the session's own state file. When `.md` files are created or changed, run the project's configured Markdown lint check against them when available and honor the repository configuration. Do not invent commands. If none exist, record SKIPPED with reason. Write verification results to the PATCH template and the session's own state file. If a required check fails, report FAIL and return to PLAN unless the failure is outside scope and explicitly accepted.

When the patch contains a confirmed bug, the verification gate runs two extra rows before the diff inspection concludes:

- **Regression baseline (expected FAIL):** PASS|FAIL/SKIPPED -- <command or n/a> -- <note or SKIPPED reason>.
- **Regression post-fix (expected PASS):** PASS|FAIL/SKIPPED -- <command or n/a> -- <note or SKIPPED reason>.

Each row is mandatory for every confirmed bug in the patch. A row with `SKIPPED` must carry a concrete reason and the nearest feasible substitute; an unjustified `SKIPPED` is a gate FAIL. A full-suite result is not accepted in either row; the row must name the targeted regression test.

### Commit/push gate (PATCH trigger)

After the Verification gate, when the session made file edits, apply the commit/push gate below before concluding PATCH. No commit or push without the ask (breach). Stage the session's edited files only; push origin then `*-mirror` remotes with per-remote reporting and no force-push. Emit the `# Commit/Push Gate` block in the PATCH template.

### Fileless PATCH branch (READ_ONLY hosts)

Applies only on a confirmed `READ_ONLY` host. `00-system.md` `## Read-only host` owns capability detection, the `SKIPPED-with-reason` standard, the Delivery contract, and all read-only surface behavior. On a read-only host, PATCH follows that contract: delivery of complete file contents replaces file edits, every write/run step reports `SKIPPED: <category> -- <reason>`, recording lands in the in-conversation carrier, and the commit/push gate never triggers. On `FILE_CAPABLE` hosts this branch does not apply.

## Commit/push gate (full rules)

The commit/push gate is the final step of PATCH when the session made file edits. It exists to prevent silent file mutations, unsanitized remote URLs in transcripts, and untracked large file commits.

### Trigger

- The gate applies only when the session's own state file has a non-empty `## Edited Files` section (one path per edit step, appended by the per-edit lint-gate recording points).
- On a confirmed `READ_ONLY` host the trigger is always false: no state file exists, so the gate never triggers, no ask is emitted, and no mutating git step runs. See the Fileless branch.
- No edits recorded in the file-carrier ledger -> the gate is skipped; state "no edits to commit" and ask nothing. On `READ_ONLY` the analog is "no edits to deliver".

### Pre-ask functional verification (Playwright MCP)

Before the ask, when the gate triggers, run a Playwright MCP functional smoke of the session's work. This is the gate's verification step: REVIEW already expects a Playwright e2e smoke (H11); this step carries the same expectation onto the commit path.

- **Trigger (any of):**
  - Web-app entry point: the repo has a `package.json` `dev`/`start` script serving a browser UI, a frontend directory with an established dev workflow, or a documented localhost URL. Detect it with a filesystem search; never assume it, never invent it.
  - UI-bearing edit: the session's `## Edited Files` contains any path matching `*.html`, `*.vue`, `*.tsx`, `*.jsx`, `*.svelte`, `*.css`, `*.scss`, or any path under `components/`, `views/`, `pages/`, `app/routes/`, `src/routes/`. Detection is a single `rg` over the edited-file set; no shell heuristic, no guessing.
- **Procedure:** start the app per its documented entry point, navigate to the app's URL, click the key flows touched by the session's edits (or the app's primary flows when the edits are not UI-specific), and capture snapshot/screenshot evidence.
- **Tool safety:** use safe browser tools only (`navigate`, `click`, `fill`, `snapshot`, `screenshot`). Never use `browser_run_code_unsafe` for a gate smoke; it is RCE-equivalent. Preflight the server before first invocation and record the result in the session's `MCP Preflight` ledger. One smoke pass per gate; re-run only after a state change.
- **Outcome:** record `PASS|FAIL/SKIPPED` with a note and the URL in the session's own state file `## Commit/Push Gate` section (`playwright_smoke`) and in the PATCH template's Verification section.
- **Hard gate:** a FAIL holds the ask. Report FAIL and return to fix; the ask is emitted only after the smoke passes or the user explicitly accepts the failure.
- **SKIPPED branches:** neither trigger condition met -> `SKIPPED: playwright-smoke -- no web-app entry point or UI-bearing edit detected`. Confirmed `READ_ONLY` host -> the smoke is never attempted and reports `SKIPPED: playwright-smoke -- gate trigger is false on a read-only host`. MCP preflight reports `not_checked` or `unavailable` -> `SKIPPED: playwright-smoke -- server not preflighted`.

### Plan-Versus-Actual Gate

A user-approved plan lists `Will change` items; this gate runs after the Playwright smoke and before lock verification, and confirms that each item actually landed in the staged working tree. The gate is the answer to "the plan said X, Y, Z - did all three really make it in?" A miss is not a soft warning; it is a hard gate. The commit is refused until the gap is fixed or the user re-plans.

#### Source of truth

The approved plan's `Will change` list, persisted in the session's own state file as `## Plan Approval -- approved_will_change` records. Each record has the shape `{id, change, verify, expect}`. The gate never re-parses the PLAN response at commit time; it uses the persisted, user-approved form. A record with no `verify` field is a coverage gap and is recorded as `SKIPPED: <id> -- no verify command` and counts as a miss.

#### `expect` vocabulary

The `expect` field on each `Will change` item is one of:

| Value | Pass criterion |
|---|---|
| `pass` | exit code 0 |
| `fail` | exit code non-zero |
| `exit:N` | exit code exactly N |
| `regex:<pat>` | exit 0 and a regex match against stdout |
| `contains:<s>` | exit 0 and the literal text appears in stdout |
| `silent` | exit 0 AND stdout is empty AND stderr is empty |

Any `expect` field that does not match one of the six shapes is recorded as `FAIL -- malformed expect: <field>` and the gate is RED. The plan author cannot pass garbage.

#### Run semantics

- Run all items in declared order on the working tree (post-staging, pre-commit).
- Each command runs in a fresh subprocess with a per-item timeout (`verify_timeout_seconds`, default 30, overridable per plan). A timeout kills the subprocess, captures whatever stdout was buffered, and records `FAIL -- timeout after Ns`. Timeout is a hard FAIL.
- Capture stdout and stderr in full, separately. Sanitize both with the credential sanitizer before recording evidence in the PATCH `## Plan-Actual` block. The unsanitized output remains in the gate's own buffer for the verdict; only the recorded evidence is sanitized. No byte cap, no synthetic digest: if the read or write tool itself truncates, mark `truncated: <reason>`; otherwise the full sanitized output is the evidence.
- The verify command string itself is capped at 2 KiB. Anything longer is rejected with `FAIL -- verify command exceeds 2 KiB` and never runs.

#### Trust boundary

The Plan-Versus-Actual Gate executes commands drawn from the user-approved plan. The commands are NOT a sandbox: they have the same filesystem, network, and credential access as the rest of PATCH. The gate MUST NOT execute commands the user did not approve, and MUST NOT execute commands whose presence in the plan was not part of the user-approved `approved_will_change` records.

#### Idempotence and mutation denylist

Verify commands MUST be idempotent; they read the working tree and may be re-run on retry. The gate applies a small denylist at runtime and rejects mutation-shaped commands with `FAIL -- command mutates state` (no execution):

- `git (commit|push|reset|clean|checkout --|restore|stash)\b`
- `(npm|pnpm|yarn|pip) install\b`
- `curl -X (POST|PUT|DELETE|PATCH)\b`

This is not a security boundary; it is a guard against accidental plan-author mistakes. BabaDev catches these at PLAN time and rewrites the verify command.

#### Verdict aggregation

- All items PASS -> `GREEN`. Gate proceeds to lock verification and the ask.
- Any item FAIL or SKIPPED -> `RED`. Trigger the auto-retry loop.

#### Auto-retry loop

- A `RED` verdict emits a PATCH `## Plan-Actual` block with the FAIL list. BabaDev is given the FAIL list, the rewrite contract, and the must-eliminate list. The retry pass may ONLY make changes that target the failing items. No scope expansion. No new dependencies. No new files outside the FAIL list. No edits to a `Will change` item that already PASSED.
- After the fix pass, re-run the gate. All items PASS -> `GREEN`, proceed to the ask. Record `Retries: 1`.
- If still RED, one more fix pass (the 2nd retry), then escalate.
- On the 2nd retry still RED: emit `BLOCKED` with `Reason: plan-vs-actual gate failed after 2 retries; see the Plan-Actual block in PATCH for the FAIL list` and refuse to emit the commit/push ask. The session returns to PLAN with a specific gap report; the user re-plans the missing items.
- A scope violation (a new file in the diff that was not in the FAIL list, or any edit outside the FAIL list) bypasses the retry budget: the gate escalates to BLOCKED on the first violation, with `Reason: plan-vs-actual gate scope violation -- retry produced changes outside the FAIL list`. No third attempt.
- The retry counter is per PATCH step, not per session. A fresh PLAN approval resets the counter.

#### Staging interaction

The gate runs AFTER `git add` of the session's edited files and BEFORE the commit. The verify commands must observe the staged state. The lock-verification step moves above the gate for the same reason: it gates what gets staged; the gate verifies what was staged. The ordering inside the commit/push gate is therefore: trigger -> Playwright smoke -> **Plan-Versus-Actual Gate** -> lock verification -> the ask.

#### Skip conditions (Plan-Versus-Actual)

Record `SKIPPED: plan-actual -- <reason>`, never silently pass:

- No `Will change` items in the approved plan -> `SKIPPED: plan-actual -- no will-change items to verify` (YAGNI; trivial edits do not need a gate).
- Confirmed `READ_ONLY` host -> `SKIPPED: plan-actual -- gate trigger is false on a read-only host`.
- DIRECT mode with no plan approved AND no `direct_gate_opt_in` flag in `## Meta` -> `SKIPPED: plan-actual -- no approved plan in DIRECT mode; rely on per-edit lint and PATCH verification`. The user-facing reason points at the modules that still protect them.
- DIRECT mode with `direct_gate_opt_in: true` set in `## Meta` -> the gate runs against the inline PATCH `## Will change` block, with `verify` fields best-effort (BabaDev writes one if it can, otherwise records `SKIPPED` per item). Same retry loop, same escalation.

#### Recording (Plan-Versus-Actual)

- Append a per-run entry to `## Plan-Actual History` in the session's state file: `{retry_index, ran_at, fail_list, fix_summary, plan_actual_verdict, scope_violations}`. Append-only.
- Record one `plan_actual: GREEN|RED|SKIPPED -- <reason>` line in `## Commit/Push Gate`.
- The PATCH template's `## Plan-Actual` block carries the per-item evidence and a `History: <N> retries logged` footer.

#### Hard rules (Plan-Versus-Actual)

- Never emit the commit/push ask while the gate is `RED`.
- Never let a `Will change` item pass without running its verify command and recording the sanitized output (no-assumed-passes rule).
- Never expand scope inside a retry pass; the rewrite contract still binds.
- A scope violation is a hard stop, not a soft fail; escalate to BLOCKED on the first violation.
- Never run a verify command longer than the configured timeout; timeout counts as `FAIL -- timeout`.
- Never cap stdout at an arbitrary byte limit; record the full sanitized output and only mark `truncated` if the read or write tool itself truncates.
- A verify command matching the mutation denylist never runs; record the denylist hit instead of executing.

#### Anti-tautology note

A `Will change` item is structurally a tautology when its `verify` command exits 0 only when the change has NOT landed, or the `expect` field is the inverse of what the command actually probes. Examples:

- `verify: rg "TODO" newfile -- expect: silent` for a change that adds a TODO literal (exits 1 when landed, 0 when absent; `silent` is a lie).
- `verify: rg "fix-me" file -- expect: pass` for a change that removes a `fix-me` marker (exits 1 when correctly removed).

The gate cannot statically prove a tautology. The PATCH `## Plan-Actual` block makes the digest visible; the retry loop exposes the inversion within 2 cycles; the audit log (`## Plan-Actual History`) gives the user a paper trail.

### Staging scope

- Stage explicit paths from the session's `Edited Files` set only.
- Never use `git add -A`, `git add -u`, `git add .`, or `git add -f`.
- Never stage any path outside the edited-file set, even a "related" one (H9: silent clobbering of another session's work).
- Never stage `SESSION_STATE-*.md`; they are gitignored; `git add -f` would force them in, so `-f` is forbidden outright.
- Never stage `.session-locks/`; it is gitignored, not source.
- Staging is self-verifying: `git status --short` must show exactly the session's edited files staged and nothing else before committing.

### Lock verification

Before any `git add`, this gate delegates to `07-protocols.md` `## Session file locks` to verify, for every path in the proposed commit:

- the current session holds the lock for that path, or
- the current session released the lock within this PATCH/DIRECT step.

If any path fails the check, staging is refused and the gate surfaces the same three options as Wait and surface (wait longer / skip this file / override-steal). The wait/surface logic lives in `07-protocols.md`; this section does not duplicate it.

After the lock check passes, this gate re-reads the working-tree version of each path and diffs it against the in-memory expected content to catch the read-then-write race that implicit-on-write locking cannot prevent. Any unowned hunk surfaces with the same three options and refuses staging.

A confirmed `READ_ONLY` host skips this section: the gate trigger is already false, so no staging and no lock check occur.

### The ask

No commit or push happens without asking first. Ask exactly once, using the decision format from `02-decision-prompts.md`:

```txt
# Decision Needed
Question: Commit and push this session's edits to origin and all mirror remotes?
Recommended: A -- keeps the repo and its mirrors in sync without sweeping in unrelated work

- A. Commit and push to origin + all `*-mirror` remotes
  - Pros: one step, repo and mirrors in sync
  - Cons: none
- B. Commit only (no push)
  - Pros: keeps changes local
  - Cons: mirrors stay behind
- C. Skip (leave edits uncommitted)
  - Pros: full control
  - Cons: session's work is not persisted

Reply with: A, B, or C
```

In STRUCTURED mode the ask carries the `[PHASE: PATCH]` header; in DIRECT mode it carries `[MODE: DIRECT]`.

### Commit

- Compose the message from the session scope in the repository's existing commit-message conventions.
- Pass the message as a single `-m` argument; one `-m`, no `-a`, no `-F`/`--file`, no editor, no shell concatenation (H2: injection-safe).
- Never put a remote URL or credential inside the message.
- Record the resulting commit sha and subject in the state file's `## Commit/Push Gate` section.

### Remote discovery

- Current branch: `git branch --show-current`. Detached HEAD -> report `SKIPPED: detached HEAD` and do not push.
- List remotes with `git remote` (names only). Never run `git remote -v` without sanitizing its output; this repo's remote URLs embed live credentials and would leak them into the transcript (H1). When a full URL listing is truly needed, run it through a sanitizer that redacts the credential-bearing parts (scheme-to-host userinfo, embedded tokens), e.g. in PowerShell: `git remote -v | ForEach-Object { $_ -replace '://[^/@]*@', '://<redacted>@' }`, then verify no credential material survives before any output enters the transcript. In this gate, names-only via `git remote` remains the practice.
- Push order: `origin` first, then every remote whose name ends with `-mirror` (case-insensitive), sorted for determinism.
- This gate discovers remotes via `git remote`, never via this repo's `targets.json`; that file is operational tooling for `sync.ps1` (deploying the system to other projects), not a remote source for the gate.
- Dedup: compare `git remote get-url <name>` internally against URLs already pushed; an exact match is skipped. The URL is never printed or recorded.

### Push policy

- Push with `git push <remote> <branch>` only.
- Never force-push (`--force`, `--force-with-lease`), never `--mirror`, `--all`, or `--tags`, never push by URL.
- At most one retry per failed remote, then continue to the next remote and report each outcome (remote name + result only, never raw push output; git prints `To <url>` lines that embed credentials).
- Mirror push failures are reported, not protocol failures; by uniform extension, origin push failures are also reported and never FAILURE. PATCH conclusion does not depend on push success.

### Recording (commit/push)

- Write the gate outcome to the session's own state file `## Commit/Push Gate` section: decision, commit_sha, message_subject, per-remote push results, gate_checked_at.
- Emit the `# Commit/Push Gate` block in the PATCH template with sanitized output only.

### Hard rules (commit/push)

- No commit or push without the ask when edits were made (breach).
- Never stage files outside the session's edited-file set (H9).
- Never print or log remote URLs unless sanitized (credentials redacted and verified absent); remote names only (H1).
- Never force-push (H3: destructive ops).
- Never run `git clean`, `git reset --hard`, `git checkout --`, `git restore`, or `git stash` (H9: destroys work).
- The gate is not a phase: it runs inside PATCH after verification and inside DIRECT before completion. The pre-ask smoke above is a gate-internal verification step, never a phase and never a second REVIEW pass.

## Cross-cutting protocol

The following concerns were merged out of 11 separate deprecated modules and consolidated into `07-protocols.md`:

- Artifact handling (`.gitignore`, `.gitattributes`, artifact categories)
- Pre-commit behavior (hook configuration, formatter/linter order, `tsc --noEmit`)
- Cross-team requirements (`CHANGES_REQUIRED.md` protocol)
- App lifecycle (startup validation, graceful shutdown)
- Library selection (signals, license check, blockers)
- Session file locks (lock directory, acquisition, release, wait-and-surface)
- Spec lifecycle (artifact format, L1/L2, registry, quarantine cascade)
- Drift detection (claims, drift verbs, HALT, fresh-eyes)
- Discuss mode (purpose, entry/exit, promotion rule)
- Scrum planning (ICE, size bands, split rule, milestones, task-card enrichment)

Read `07-protocols.md` when any of these are in scope. The cross-references in the phase templates (PATCH, REVIEW, PLAN) point there.
