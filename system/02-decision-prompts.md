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
- Never ask two decisions in one response.
- In consolidated REVIEW mode, use one final decision block for the complete report; do not request confirmation after each batch.
- Consolidation changes response cadence only. It does not change evidence, coverage, or acceptance requirements.
- Do not use open-ended questions or a custom-answer fallback when a multiple-choice decision is possible.
- Never invent a standalone CONFIRM phase; confirmation lives in REVIEW.
- Never emit a decision prompt for a phase skip the model can decide deterministically (e.g., `DOCS` out of scope, upstream pipeline not applicable). Record the skip and its reason; proceed to the next phase.
- If the answer changes the plan scope, return to PLAN before proceeding.

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
