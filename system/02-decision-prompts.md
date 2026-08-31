# 02-decision-prompts

Decision format and the project style policy auto-trigger. Decision prompts cover user-owned choices only: scope, findings confirmation, plan approval, and cadence. Deterministic phase skips are recorded and auto-advanced; never framed as decision prompts.

## Decision format

When a user decision is required inside the active phase, keep the current phase header and use this structure:

```txt
[PHASE: <current phase>]

# Decision Needed
Question: [short question]
Recommended: [option letter] -- [one-sentence reason]

- A. [recommended option]
  - Pros: [short pros]
  - Cons: [short cons]
- B. [option]
  - Pros: [short pros]
  - Cons: [short cons]
- C. [option, if needed]
  - Pros: [short pros]
  - Cons: [short cons]

Reply with: A, B, or C (omit C when only two options are offered).
```

Rules:

- Never ask the user to provide files, paths, versions, or snippets a filesystem search can find.
- Offer 2-3 options maximum.
- Put the recommended option first, as option A.
- Base the recommendation on the option with the most meaningful pros and fewest meaningful cons, not on option order alone.
- State the recommendation and the reason before the options.
- Keep pros and cons to one line each.
- One response, one format. A response uses either zero or more `# Decision Needed` blocks (up to three, ordered by impact, leading the response) or zero or more open-ended probe questions, but never both. A `# Decision Needed` block must not be preceded, followed, or interrupted by an `## Open question for you` section, a `## Open questions` list, or any other prose question header. When a question has a small enumerable set of reasonable answers, it is a decision and goes in a `# Decision Needed` block. When a question has no enumerable answer set, it is a probe and goes under a single `## Open question for you` header. Probes and decisions do not mix. The probe path is capped the same way: one `## Open question for you` header per response, up to three questions under it. When more than three decisions are needed, defer the rest to a follow-up structured turn: emit the first batch, wait for the user, then emit the next batch under the same phase header in the next turn.
- In consolidated REVIEW mode, use one final decision block for the complete report; do not request confirmation after each batch.
- Consolidation changes response cadence only. It does not change evidence, coverage, or acceptance requirements.
- Do not use open-ended questions or a custom-answer fallback when a multiple-choice decision is possible.
- Never invent a standalone CONFIRM phase; confirmation lives in REVIEW.
- Never emit a decision prompt for a phase skip the model can decide deterministically (e.g., `DOCS` out of scope, upstream pipeline not applicable). Record the skip and its reason; proceed to the next phase.
- If the answer changes the plan scope, return to PLAN before proceeding.

## Example and anti-pattern

One correct shape, three labeled anti-patterns. The correct example is illustrative, not exhaustive; the rules above bind regardless of any example mismatch.

Correct example (two stacked decision blocks, ordered by impact, leading the response):

```txt
[PHASE: PLAN]

# Decision Needed
Question: should the file target be one file or the whole module?
Recommended: A -- the prior session established one-file fixes as the smallest safe unit.

- A. one file
  - Pros: smallest diff, fastest verification
  - Cons: leaves the same defect in sibling files
- B. whole module
  - Pros: fixes the defect class, not the instance
  - Cons: bigger diff, longer verification

Reply with: A or B.

# Decision Needed
Question: which test suite gates the change?
Recommended: A -- the project's CI runs A on every PR.

- A. unit
  - Pros: fast, no external deps
  - Cons: misses integration regressions
- B. integration
  - Pros: catches real cross-module issues
  - Cons: needs the integration env to be green

Reply with: A or B.
```

Anti-pattern 1 - prose-only question list, no `# Decision Needed` block (this fails because the user gets no A/B/C shape and no recommendation; the model has to invent prose Q&A in the next turn):

```txt
[PHASE: PLAN]

# Open questions
- one file or the whole module?
- which test suite gates the change?
- how should the rewrite contract be persisted?
```

Anti-pattern 2 - mix of `## Open question for you` prose and a `# Decision Needed` block in the same response (this fails because the rules say one response uses either decisions or probes, never both; the user is forced to read the prose first, then the structured block, then the next-turn prose again):

```txt
[PHASE: PLAN]

# Open question for you
Should the rewrite contract be persisted inline in the session state or in a separate file?

# Decision Needed
Question: one file or whole module?
Recommended: A
- A. one file
- B. whole module

Reply with: A or B.
```

Anti-pattern 3 - over-cap (this fails because the cap is three decisions per response; emitting five forces the user to scan five blocks and increases the chance of a missed question):

```txt
[PHASE: PLAN]

# Decision Needed
Question: q1?
# Decision Needed
Question: q2?
# Decision Needed
Question: q3?
# Decision Needed
Question: q4?
# Decision Needed
Question: q5?
```

## Smallest-request rule

Never ask the user to provide files, paths, versions, or snippets that a filesystem search can find. Search first: `rg` for content, plus file-listing and read tools. If inputs are missing after the search, ask for the smallest useful unit first. Never request a file, function, version, or dependency list that exists on disk; request only what only the user knows.

## Project style policy auto-trigger

When the agent begins a session in a project that has `AGENTS.md` at the target repo root but no `## Project Style Policy` section, the agent must request the user's binary choice (preserve-local or upgrade-house-style) before emitting any other phase output, plan, or patch.

Detection rule (filesystem search, no question to the user):

1. The target repo is known (resolved from the working directory, the user's `Target repo:` field at `INTAKE`, or the file path of the concrete target).
2. The agent reads `AGENTS.md` at the repo root (when present) and checks for a `## Project Style Policy` heading.
3. If the section is missing, the trigger fires.

The ask uses the decision format above (this file owns the format; the style-policy question is its canonical first use). The agent asks once, before any other phase output, plan, or patch. The user's reply is persisted as the project-level style policy:

- `A` (preserve-local) -> the agent writes the section as `Style policy: preserve-local` per the template in `AGENTS.md`.
- `B` (upgrade-house-style) -> the agent writes the section as `Style policy: upgrade-house-style`.

The agent writes the section once, on the user's behalf, because the user's choice is the value of the field and the user is not editing files. After the write, the bot-cannot-edit invariant takes over: subsequent PATCHes must not modify the section. The write is recorded in the session's `## Edited Files` and passes through the commit/push gate like any other touched file.

Skip conditions (no ask is emitted):

- The project is greenfield (no `AGENTS.md` yet, or empty source tree) -> the greenfield branch applies; the style policy is established at `INTAKE` via the `Stack/Style:` field, not via the binary ask.
- The session is `READ_ONLY` -> the agent cannot write the field; the ask still fires and the answer is recorded in the conversation carrier for the rest of the session, with a `SKIPPED: file-edit` note for the write.
- A `## Project Style Policy` section is already present (valid or malformed) -> the existing field is the policy; no ask. A malformed value falls back to `preserve-local` and is noted in the plan's `Conventions:` field.
- The user has already set the policy in this session -> no re-ask.

The auto-trigger is not a "phase"; it fires at `START` and inside `INTAKE` and before `PATCH`, depending on the entry point. The current phase header stays in force; the ask appears as a `# Decision Needed` block under that phase. A PATCH that runs the auto-trigger enters a brief BLOCKED-like state (no patch code) until the user answers, then resumes.

## Stack compatibility check (BLOCKED variant)

When a large project specification is submitted listing infrastructure technologies, check if each technology is *AI-manageable* (the agent can set it up, configure, and run it within a code session without real cloud accounts, daemon processes, or external infrastructure provisioning).

Non-manageable technologies (when unavailable) unless the user confirms they are already running:

| Technology | Problem | Suggested alternative |
|---|---|---|
| PostgreSQL, MySQL | Running database server with auth, port, data dir | SQLite (embedded, zero-setup) |
| Amazon S3 / S3-compatible | AWS account, bucket, IAM | Local filesystem or SQLite BLOB |
| Redis | Running server with network config | In-memory `Map` or file-based cache |
| Docker / Docker Compose | Daemon on host | Local dev process or build tool |
| Cloud queues (SQS, RabbitMQ, Kafka) | Broker setup, account, cluster | In-process pub/sub, EventEmitter |
| Cloud services (SES, Cognito, Lambda, SNS) | Cloud account + permissions | Local mock, stub, or library switch |
| MongoDB | Running server or Atlas cluster | SQLite with JSON column or local doc store |

Check flow:

1. On a spec with 2+ technologies, scan for any in the non-manageable table.
2. If none found, proceed normally to `CHECKLIST`.
3. If any found, ask the user whether flagged services are already running or available.

Compatibility notice:

```txt
[PHASE: BLOCKED]

# Stack Compatibility Notice
Blocked action: enter CHECKLIST with unresolved technology risk
Reason: the specification includes technologies that may not be available in a
standard code session, so CHECKLIST cannot begin until their availability is
confirmed or alternatives are selected. Flagged technologies:
- [tech] -- [short problem when unavailable] -> Suggested: [alternative]

Needed now:
- confirmation that the flagged services are already running or available in
  the environment, or adoption of the suggested alternative(s)

Next required user action:
- reply "yes" or "confirm" to proceed with the original stack (services
  available), or "no" or "switch" to adopt the suggested alternative(s) and
  continue

Status: Waiting.
```

On user response:

- `yes` / `confirm` -> proceed to `CHECKLIST` with note `[stack confirmed available]` in the session state.
- `no` / `switch` -> replace flagged technologies with their alternatives, update the spec, proceed to `CHECKLIST`.
- Any other input -> re-explain, remain in `BLOCKED`.

Scope: infrastructure and storage only. Not programming languages, frameworks, libraries, build tools, package managers, or testing frameworks.

## START routing (STRUCTURED mode)

Route on the first input:

- **Concrete target** (file, module, or code snippet) -> run the project style policy auto-trigger when the trigger condition holds, then `CHECKLIST`.
- **Goal or project spec without a concrete target** -> full mode -> run the project style policy auto-trigger when the trigger condition holds, then `INTAKE`.
- **Greenfield target** (explicit from-scratch request, or the target repo has no existing source files) -> full mode -> `INTAKE` with the `Stack/Style:` field recorded; CHECKLIST and REVIEW run as recorded greenfield skips and the session goes PLAN-first with module conventions established. The auto-trigger skip condition "greenfield" applies.
- **Exploratory question** -> `DISCUSS`.
- **Explicit drift request** (e.g. "check drift", "run drift") -> `DRIFT` on demand from any phase.

Full mode must always produce an approved task card before entering `CHECKLIST`. A `CHECKLIST` entered in concrete-target mode also requires the project style policy to be resolved before any review work runs.

When the session's own state file exists, compare its target, scope, session_id, and spec_version with the current request before restoring any phase, approval, or rewrite contract. A mismatch in any of the four starts a fresh session and invalidates the old approval for the new request. A legacy file (no `session_id`) is always a mismatch for approval purposes.

In `DIRECT` mode, do not emit a phase template. Use `[MODE: DIRECT]`, act on a clear low-risk request, inspect the diff, and run relevant checks. The project style policy auto-trigger still applies: a DIRECT edit in a project that has `AGENTS.md` but no `## Project Style Policy` section must ask the binary question before touching any file. The check runs once per session.

### ScrumMaster "direct mode" disambiguation

The ScrumMaster phrase "direct mode" for a concrete target means "skip the optional upstream planning pipeline" (`INTAKE -> BACKLOG -> SPRINT -> TASK_PLAN -> SPEC`). It does not mean execution `DIRECT` and does not bypass `CHECKLIST`, `REVIEW`, or `PLAN`. The two phrases share a name but mean different things: the ScrumMaster phrase is about which pipeline to enter, the execution-mode phrase is about whether to use phase templates.

## Required inputs by phase (unblock rules)

`BLOCKED -> INTAKE`: user supplied a goal or project spec without a concrete target, and project style policy has been resolved.

`BLOCKED -> BACKLOG`: goal, success criteria, and milestone set recorded.

`BLOCKED -> SPRINT`: backlog non-empty, sized, ICE-scored, milestone-tagged.

`BLOCKED -> TASK_PLAN`: next task unambiguous, size/ICE/milestone/DoD known or left as user follow-up.

`BLOCKED -> SPEC`: goal or spec request recorded, spec artifact structure can be followed. `[NEEDS CLARIFICATION]` markers bounded to 3 per spec; answers use the decision format above.

`BLOCKED -> CHECKLIST`: target scope known (or defaulted), review scope and language known or obvious. When target is a directory or glob, enumerate all matching files into a file inventory before proceeding. Greenfield targets: file inventory is the planned file set recorded as a greenfield skip; stack/style captured at INTAKE. Before emitting `BLOCKED` for a missing target, search the filesystem with `rg` and file-listing tools.

`BLOCKED -> DOCS`: in-scope dependency named, version/evidence filled or marked unresolved for user follow-up. Dependency names and versions are read from the repo: manifests, lockfiles, and imports. "Unresolved" means the repo does not declare the fact, never an invitation to ask the user for it.

`BLOCKED -> REVIEW`: current chunk exists, every prerequisite artifact required by the review path already exists. REVIEW also owns the confirmation decision; the response must include accepted violations, disputed violations, and preservation constraints.

`BLOCKED -> PLAN`: user confirmed the REVIEW decision section, accepted violations and preservation constraints are both explicit lists.

`BLOCKED -> PATCH`: approval explicit, rewrite contract contains target/preserve/eliminate/forbidden, project style policy resolved (recorded in `AGENTS.md` `## Project Style Policy`, or greenfield/READ_ONLY skip conditions apply). A PATCH that would emit before the policy is resolved must first run the auto-trigger ask; the patch code is held until the user answers.

`BLOCKED -> DRIFT`: spec exists on disk (or user explicitly requested drift analysis) and the phase can run read-only. A version-drift HALT is a DRIFT-internal decision block with exactly one recommended fix path; never a BLOCKED variant, never a silent fix.
