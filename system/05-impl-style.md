# 05-impl-style

Implementation style core. Stack variants are inline sections below; pick the one matching the session's active language. Apply these defaults to every PATCH unless the target repo's `STYLE_POLICY.md` artifact or the INTAKE `Stack/Style:` field overrides them.

## General principles

- DRY
- KISS
- Composition over inheritance
- SOLID and CUPID where complexity justifies them
- Dependency injection over hidden construction. Use the stack's mandated DI container. Favor constructor injection; wire the composition root at the application entry point. Default to transient lifetime unless a clear singleton or scoped rationale exists.
- Single source of truth
- Early returns over deep nesting
- Big-O awareness for hot or scalable paths
- Security and type safety are first-class concerns

## Greenfield projects (new projects and new files)

When the target is a new project from scratch, or new files being added to a repo that has no established local conventions (empty or near-empty source tree, no existing style), the defaults in this file ARE the project conventions until the user explicitly overrides them:

- the mandated stacks and helpers (see the per-stack sections)
- the error-handling idiom for the stack
- naming and file-naming rules (kebab-case, snake_case, PascalCase per stack)
- project structure (flat `src/`, split at 8 files, layer names)
- region tags for new projects
- the code-decision ladder, comment policy, and logging palette

This is the one case where "defaults" are binding rather than advisory: a greenfield scaffold has no existing conventions to preserve, so the module defaults fill that role. A deviation from a greenfield default requires explicit user approval recorded in the INTAKE `Stack/Style:` field or the PLAN `Conventions:` field; an agent must never silently substitute its own generic conventions. The "strong defaults, not absolute laws" framing above continues to apply to existing codebases, where the local-convention policy governs.

## Local-convention policy

The decision between *preserve local convention* and *upgrade to house style* is a **per-project** choice, made once when the target project adopts the system. There is no per-file override.

- The decision is recorded in the target project's `STYLE_POLICY.md` artifact. Once recorded, the bot **must not** modify that artifact.
- If the artifact is missing or malformed in a target project, the bot runs the auto-trigger ask from `02-decision-prompts.md` (which recommends `preserve-local` as option A) and proceeds with the result.
- If the user declines the ask or the ask cannot run, the bot defaults to `preserve-local` and emits a one-line note in the plan that the field is unset or invalid, so a human can correct it.
- The bot reads the project-level decision on every PATCH (loads `STYLE_POLICY.md`; the field is a single line in frontmatter). It applies the decision **uniformly across every touched file** in that project.
- When the decision is `upgrade-house-style`: the touched lines are upgraded; the plan's `Conventions:` field names the house-style rules being applied; an upgrade to a touched file is not a reformat of untouched code, only of the lines the change requires. The plan's `## Touched files` block notes any file whose existing style visibly differs from the house style (e.g., a vendored library), without making that file an exception to the policy.
- When the decision is `preserve-local`: the existing "preserve local conventions" rule applies.
- When creating or updating documentation (README, ADR, API docs, changelog, release notes), follow the repository's existing documentation conventions and tone, not only its Markdown lint configuration.
- Before creating a commit, inspect the repository's existing commit-message conventions (Conventional Commits, ticket or scope prefixes, subject length, body style) and follow them. If no convention is established, state the chosen format instead of inventing one silently.

Pass-assertion discipline: see `03-output-and-state.md` global rule. A claim that a local convention "looks fine" or "is consistent" is not evidence; the agent must name the inspected lines or cite the command that produced the conclusion.

## Error-handling idiom consistency (all stacks)

- The error-handling idiom that dominates a file or codebase wins. Before choosing how a new or changed code path reports failure, read the touched file and identify its established idiom: exit-code guards (`$LASTEXITCODE`), Result-style helpers, or exceptions.
- Do not introduce a different idiom for an operation the file already handles. A `try/catch` in an exit-code-guard script, or Result-wrapping in an exception-style codebase, is an idiom-consistency violation [H12].
- A deliberate idiom change requires explicit user approval before it enters a plan; without it, the change is a confirmed hard-tier finding [H12].
- The per-stack sections state preferred helpers, but the dominance rule overrides them when the file's established pattern differs.

## Design heuristics

- Prefer reusable abstractions only when repetition or a real variability axis exists.
- Use YAGNI for hypothetical features.
- Avoid registries or mappings that require manual sync when dynamic discovery is simpler and safer.
- Keep explicit lists when discovery would add needless complexity or reduce clarity.
- Consider one-off versus repeating cost before abstracting.

### Code-decision ladder

Before writing new code, stop at the first rung that holds:

1. Does this need to exist at all? YAGNI; skip speculative features.
2. Already in this codebase? Reuse the helper, util, type, or pattern; look before you write.
3. Does the standard library do it? Use it.
4. Does a native platform feature cover it? Use it (CSS over JS, DB constraint over app code).
5. Does an already-installed dependency solve it? Use it; never add a new one for what a few lines can do. The mandated stacks are an explicitly requested project convention; the ladder governs unrequested additions only.
6. Can it be one line? One line.
7. Only then: the minimum code that works.

The ladder runs after full comprehension, never instead of it: read the task and the code it touches, trace the real flow end to end, then climb. Guardrails:

- Never let a rung simplify away input validation at trust boundaries, error handling that prevents data loss, security, or accessibility; those are protected by the hard-tier rubric.
- Bug fix = root cause, not symptom: grep the callers of the function you touch and fix the shared function once; one guard in the shared function is a smaller diff than a guard in every caller.
- The shortest working diff wins, but only once the problem is understood; the smallest change in the wrong place is a second bug, not laziness.

## Stepdown rule (S14)

Functions read top-to-bottom. Each function calls functions one level of abstraction below it. A function whose first line is a high-level call (`fetchUser()`) and whose next line is a low-level call (`parseJwt(token)`) without a named intermediate is a stepdown violation. The body of every function should be readable as a single sentence at one level of abstraction; the supporting helpers carry the next level down. (Martin, *Clean Code* ch. 3 "One Level of Abstraction per Function" / ch. 11 "The Stepdown Rule".)

## Newspaper order (S15)

A file reads like a newspaper article: headline first, then increasingly fine-grained detail as you scroll. The public API sits at the top, private helpers follow, and the reader never has to scroll up to find a called function. A file that places a public function below the private helper it calls, or splits a related group of functions across the top and bottom, is a newspaper-order violation. (Martin, *Clean Code* ch. 5 "The Purpose of Formatting" / ch. 11 "The Newspaper Metaphor".)

## Flag arguments and output arguments (S16)

A boolean flag argument almost always means the function does two things; split it. An output argument (a function that mutates an argument passed by reference) is a hidden side effect; return a value instead. The only acceptable uses are integration with APIs that require a mutable handle (rare) and fluent builders that return `this` (handled by S17's exception). (Martin, *Clean Code* ch. 3 / ch. 8 "Function Arguments" - Flag Arguments and Output Arguments.)

## Tell, don't ask - Law of Demeter (S17)

A method should not reach through another object to access its parts. `customer.wallet.balance.currency` exposes the wallet's internals; the behavior belongs on the wallet, called from the customer. Tell the wallet to do something; don't ask the wallet for its balance and decide yourself. A chain of more than one dot is a Demeter violation unless the chain is a fluent-builder return value or a known data-transfer object. (Martin, *Clean Code* ch. 6 / ch. 12 "Objects and Data Structures".)

## Minimal verification floor

- Non-trivial new logic (a branch, a loop, a parser, a money/security path) leaves one runnable check behind; the smallest thing that fails if the logic breaks: an assert-based self-check or one small test file. No test frameworks, fixtures, or per-function suites unless asked.
- Trivial one-liners need no test; YAGNI applies to tests too.
- This floor never replaces the per-edit lint gate or the project checks; it is the minimum, not the ceiling.

## Project structure

- Start new projects with a flat `src/` directory.
- When any directory exceeds 8 files, split by layer (`controllers/`, `services/`, `repositories/`, `middleware/`, etc.).
- Do not split preemptively.
- Keep configuration and tooling files at the repository root (`tsconfig.json`, `pyproject.toml`, `opencode.jsonc`, `.markdownlint.jsonc`), not inside `src/`; keep reusable scripts in a root-level `scripts/`.
- Keep tests beside the code they cover using the stack's test suffix, or in a top-level `tests/` mirroring `src/` when the project prefers separation; pick one convention per project.
- Use kebab-case for directory names (`user-profile/`, `api-gateway/`).
- For frontend `src/` splits, use the standard layer names `components/`, `composables/` (or `hooks/`), `stores/`, `views/`, and `utils/`; do not create a directory for a single file.

## Comments

*Reference: Robert C. Martin, Clean Code -- chapter 4 (1st ed., 2008) / chapter 5 (2nd ed., 2025). The categories below are Martin's, with stack-specific markers added on top.*

**Content over prefix.** The rule is what the comment says, not what character starts it. Prefix follows the language (`//` in TS/JS/Java/Pine, `#` in Python/PowerShell/Bash, `--` in SQL/Lua/Haskell -- automatic, not policed here). Stack sections do not re-state the prefix; this is the only place the prefix is mentioned.

**Why, not what.** Never restate the next line of code. Never write `// increment counter` above `i++`. Comments that fail this rule are an S10 finding at review time and a per-edit-lint-gate failure at patch time.

**Good comments - categories that earn a comment (Martin ch. 4 / ch. 5):**

- **Legal comments** -- copyright, license, or authorship headers required by a contract. Place once at the top of the file; never duplicate.
- **Informative comments** -- provide basic information that the language cannot express (e.g., the regex pattern's meaning, the byte order of a packed struct). Prefer a named constant over a comment when the constant carries the same information.
- **Explanation of intent** -- why a block of code exists, not what it does. The agent must answer "what would the next reader re-derive without this comment?" in one sentence. Use the marker `// why: <one-line reason>`.
- **Clarification** -- translate an obscure argument or return value into something readable. Use only when the alternative is worse than the comment (e.g., a standard-library call whose return value is genuinely confusing).
- **Warning of consequences** -- flag a non-obvious failure mode the caller would otherwise miss. Use the marker `// safety: <one-line consequence>`.
- **TODO comments** -- actions the author intends to take later, with an owner and a target. Format: `// TODO(<owner>): <what> -- <why deferred>`. A TODO without an owner is disallowed by default.
- **Amplification** -- make an otherwise subtle line of code louder. Use sparingly; if the code needs amplification, refactor it first.
- **Public-API docstrings** -- public-API docstrings are required for any function, class, or module that crosses a package or service boundary. Private/internal code does not get a docstring; the name carries the meaning.

**Bad comments - categories that violate this rule (Martin ch. 4 / ch. 5):**

- **Mumbling** -- a comment that says something without saying anything useful. Always delete.
- **Redundant comments** -- restate the next line of code in prose. Always delete.
- **Misleading comments** -- say one thing while the code does another. Worse than no comment. Delete and fix the code or the comment.
- **Mandated comments** -- required by a process but not by the code (e.g., "this function exists"). Delete; the function name is the mandate.
- **Journal comments** -- change logs at the top of a file ("added by X on Y"). Use git, not a comment.
- **Noise comments** -- restate the obvious in a noisy way. The agent's specific bans: `// ----- HEYO -----`, `// ==== Section ====`, ASCII art separators, `// some random label` headers, "this method does X" above a method named `doX`.
- **Scary noise** -- loud markers (e.g., `////////////////////////////////////////////`) that signal a section by visual weight rather than by structure. Use `// #region LABEL` / `// #endregion` instead. Region tags are the only sanctioned way to mark a section.
- **TODO without owner** -- `// TODO: fix this` with no owner and no target. Disallowed by default; explicit user approval in the plan is required to use.
- **Position markers** -- banner comments like `// ACTIONS` placed at arbitrary columns to organize the file. Use a section break, an extract-method refactor, or a region tag.
- **Closing-brace comments** -- `// } end of while` placed next to a closing brace. Delete; the indentation and a small function carry the meaning.
- **Attributions and bylines** -- `// Added by Simon` at the top of a function. Use git blame, not a comment.
- **Commented-out code** -- dead code left as a comment. Delete; git has the history.
- **HTML in comments** -- `// <b>important</b>` in a code comment. The renderer is not the reader.
- **Nonlocal information** -- a comment that refers to a system-wide context the reader won't have (e.g., "this corresponds to issue #1234" without a link). Cite the URL inline if the context matters.
- **Too much information** -- a multi-paragraph essay in a code comment. The file is not a blog.
- **Function headers** -- a block comment at the top of every function describing what it does. The function name and signature carry the meaning; a docstring is enough.
- **Docstrings in nonpublic code** -- verbose docstrings on private functions. Required only on public-API boundaries.
- **Markup in comments/docstrings** -- no Markdown, reST, or other rendering markup (`*`, `_`, ` ` `, ` `` `, `>`, `#`, `[]()`, etc.) inside code comments or docstrings. Plain prose only. Exception: when a documentation generation library (Sphinx, pdoc, TypeDoc, JSDoc, Doxygen, rustdoc, etc.) is explicitly configured in the project and its format requires specific markup, that markup is allowed and the project's tooling config is the source of truth.

Deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n^2) scan, naive heuristic) are marked with a `simplify:` comment naming the ceiling and the upgrade path, e.g. `# simplify: global lock -- per-account locks if throughput matters`.

## Markdown defaults

- When creating or updating `.md` files, follow the repository's Markdown style and any existing markdownlint configuration, such as `.markdownlint.jsonc`.
- Run the repository's configured Markdown linter for changed Markdown files when available. Do not invent a lint command when no project check exists.
- Do not disable Markdown rules inline or in configuration unless the exception is explicitly required and documented.

## Region tags

- Use `// #region LABEL` / `// #endregion` (or language-equivalent syntax) to group related code in greenfield projects. Region tags are also added to an existing file when the project-level style decision is `upgrade-house-style`.
- Do not add region tags to existing codebases whose project decision is `preserve-local`, unless the file already uses them.
- Labels should be short, descriptive Title Case, e.g. `// #region Database Layer`.

## Naming

Names must reveal intent, usage, and role. Reference: Robert C. Martin, *Clean Code* chapter 2 (1st ed., 2008) / chapter 4 (2nd ed., 2025) -- "Meaningful Names." Apply the rules there as the house style. The project-specific markers that follow are how this system names the same ideas: classes are nouns (`UserService`); functions are verbs (`calculateTotal`); booleans read like facts (`isAdmin`, `hasPermission`, `canRetry`); in TypeScript class code, prefer underscore-prefixed private fields as a default house style.

## File naming

- Name every file after its primary concept or export; a file exporting several unrelated helpers should split.
- Default to kebab-case filenames unless the stack section says otherwise: `user-service.ts`, `pre-commit-config.yaml`, `architecture.md`. This matches this repository's own system and doc naming.
- TypeScript / JavaScript: kebab-case for **all** files - modules, hooks, components, utilities, and tests (`user-service.ts`, `use-user-profile.ts`, `user-profile.tsx`, `user-repository.ts`, `user-service.test.ts`). PascalCase governs identifiers inside a file (the exported component/class name), not the filename.
- Python: snake_case modules per PEP 8 (`user_service.py`); tests use the `test_` prefix (`test_user_service.py`).
- Java: PascalCase class files matching the public class name per Google Java Style (`UserService.java`); tests use `*Test.java` / `*IT.java`.
- Frontend: kebab-case filenames for components and everything else (Vue SFCs `user-profile.vue`, React `user-profile.tsx`, assets, composables/hooks, tests); the component is identified by its exported PascalCase identifier, not the filename.
- Avoid file names that differ only by case (`user-service.ts` vs `UserService.ts`); they collide on case-insensitive filesystems and break cross-platform checkouts.
- Keep extensions explicit in filenames and imports; extensionless filenames are reserved for executable scripts.

## Security defaults

- Sanitize untrusted input and output where relevant.
- Use parameterized queries / prepared statements for data access.
- Prefer explicit validation at boundaries.

## Logging defaults

- Use semantic color mapping: **red family** (error/fatal), **yellow/orange** (warn), **blue/green** (info/success), **gray/dim** (debug/trace).
- Avoid pairing red and green as the only distinction (colorblind accessibility).
- Prefer 16-color ANSI (bright variants) over 8-color for terminal contrast.
- Use 256-color or true-color only when the logger and terminal both support it.
- House palettes are Catppuccin Mocha and Dracula. Prefer Mocha unless the project already uses Dracula.

### Catppuccin Mocha

| Level | Color | Hex | ANSI 256 |
|---|---|---|---|
| ERROR | Red | #f38ba8 | 203 |
| WARN | Peach / Yellow | #fab387 / #f9e2af | 215 / 221 |
| INFO | Sapphire / Blue | #74c7ec / #89b4fa | 81 / 110 |
| DEBUG | Lavender | #b4befe | 183 |
| TRACE | Overlay1 / Surface2 | #7f849c / #585b70 | 102 / 59 |

### Dracula

| Level | Color | Hex | ANSI 256 |
|---|---|---|---|
| ERROR | Red | #ff5555 | 203 |
| WARN | Orange / Yellow | #ffb86c / #f1fa8c | 215 / 221 |
| INFO | Cyan / Green | #8be9fd / #50fa7b | 81 / 119 |
| DEBUG | Purple | #bd93f9 | 141 |
| TRACE | Comment (dim) | #6272a4 | 60 |

- Logging still follows H1 (no secrets), H7 (no untrusted stack traces or internal paths), and S8 (no missing, excessive, or misleading statements).

## Command-line and workflow defaults

- Suggest PowerShell commands first when the project is Windows-centric; invoke in this order: `pwsh` 7.6 first, then Windows PowerShell 5.1, then `cmd`, then `bash`. Default to `pwsh` 7.6 unless the project is pinned to Windows PowerShell 5.1.
- Use `rg` (ripgrep) for content search.
- Use regex for multi-file replacements when appropriate.
- Do not generate files or execute commands unless explicitly asked, except during PATCH verification and the per-edit lint gate, where running project checks (lint, typecheck, tests) is required.

## Testing coordination

- If BabaTester provides binding test evidence, treat it as part of the implementation contract.
- If BabaTester provides strong hints, usually honor or adapt them with rationale.
- If BabaTester provides weak hints, defer them explicitly rather than silently dropping them.
- Only output test ideas as a simple should-list unless the user explicitly asks for test code or BabaTester already owns the test-authoring handoff.

## Style floor

The defaults above are a floor, not a ceiling. They never replace the per-edit lint gate or the project checks; they are the minimum, not the maximum. The project style policy in `STYLE_POLICY.md` (`preserve-local` or `upgrade-house-style`) controls how the floor interacts with the file's existing style.

## Stack: TypeScript / JavaScript

- Strict mode: `"strict": true` in `tsconfig.json`. `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`.
- `any` is forbidden; use `unknown` and narrow.
- `as` casts require a follow-up type guard or `// @ts-expect-error: <reason>` (binding) with a one-line reason.
- `null` vs `undefined`: prefer `undefined` for "not set" and `null` only when an API contract demands it.
- Async: `async/await` over `.then` chains; `Promise.all` for independent work; never fire-and-forget without a documented reason.
- Errors: typed error subclasses or discriminated unions; `try/catch` only around the failing call, not around the whole function; never `catch (e) {}`.
- Imports: `import { foo } from './foo'` over `import * as foo from './foo'`. `import type { Foo } from './foo'` for types.
- Exports: named exports over default exports except where the framework requires a default (React components, route handlers).
- React (when in scope): function components over class components; hooks at the top level, never in conditionals; props typed via interface or `type`; `useEffect` cleanup function for every subscription; no inline object/array literals in dependency arrays.
- Node (when in scope): `node:` prefix on built-in imports (`node:fs`, `node:path`); ESM by default; `process.exit` only at the top of the entry point.
- Prefer `for...of` over `forEach` for control-flow clarity.
- Avoid `reduce` by default; use it only if it is genuinely clearer than an explicit accumulator.
- Avoid awaiting inside loops unless sequential behavior is required.
- Use type guards when they materially improve safety or readability.
- Do not use unsafe assertions to silence the type system.
- For Node code, assume Node 20 and TS 5.x unless the project states otherwise.
- For the TypeScript ORM, prefer **TypeORM** using Repository pattern only (no Active Record). Decorator-style entity definition is the single enforced style. MikroORM is acknowledged as more type-safe and robust but production experience shows TypeORM makes fewer real-world problems for this team.
- DI container: **tsyringe**. Favor constructor injection; wire the composition root at the application entry point. Default to transient lifetime unless a clear singleton or scoped rationale exists.
- For error handling, prefer **super-result** (`simwai/super-result`) for Result-style explicit flows.
  - **Style: caller-handled, no chaining.** Use `if (result.ok)` / `if (result.err)` type narrowing.
  - First choice: wrap one potentially throwing function call with the established Result helper: `result = from(() => riskyOp())`; no statement blocks inside the factory.
  - A `try/catch` whose only purpose is to convert one function call's thrown error into `err(...)` is always a code smell. Prefer the Result helper instead.
  - Use `try/catch` only when the catch block has additional responsibilities that the Result helper cannot express clearly, such as handling multiple operations, branching on the exception, or performing required cleanup.
  - Do not use `.map()`, `.andThen()`, `.match()`, `.unwrapOr()` or other chaining methods on results.
- If `neverthrow` is already established in the codebase, continue using it; do not mix both.

## Stack: Python

- Write Pythonic, readable code with PEP 8 style.
- Assume Python 3.12 unless the project states otherwise.
- Type annotations on every function signature: parameters and return type. `Any` requires inline `# pyrefly: ignore` comment with a written reason.
- Modern type syntax: `list[int]`, `dict[str, int]`, `X | None` over `Optional[X]`, `from __future__ import annotations` only when needed for forward refs.
- New data classes default to `@dataclass(slots=True)` from `dataclasses`. Use `slots=False` only when inheritance conflicts (document why).
- Naming: snake_case for functions/variables/modules, PascalCase for classes, UPPER_SNAKE_CASE for constants.
- Imports: `from x import y` style; `__init__.py` re-exports; no wildcard imports.
- Errors: raise specific exceptions; chain with `raise NewError(...) from original`; never bare `except:` or `except Exception:` without re-raise.
- Tests: pytest with `arrange-act-assert`; fixtures for setup; parametrize for input variation; no test interdependence.
- Async: `asyncio` over thread pools; `async def` only when I/O-bound and the codebase is async; never mix sync and async in the same call chain.
- Package management: tooling detection first in an existing project. In an existing Python project, detect the active toolchain from marker files before running any install/add/lint/test command and route every Python command through it:
  - `pdm` - `pdm.lock`, `[tool.pdm]` in `pyproject.toml`, or `.pdm-python` present: use `pdm install`, `pdm add`, `pdm run <cmd>`.
  - `poetry` - `poetry.lock` or `[tool.poetry]` in `pyproject.toml`: use `poetry install`, `poetry add`, `poetry run <cmd>`.
  - `uv` - `uv.lock` or `[tool.uv]` in `pyproject.toml`: use `uv sync`, `uv add`, `uv run <cmd>`.
  - bare venv - `.venv/`, `venv/`, or `env/` containing an interpreter: invoke that interpreter directly (`<venv>\Scripts\python.exe` on Windows, `<venv>/bin/python` elsewhere) instead of the system Python.
  - Precedence when multiple apply: a configured tool (lockfile or tool table) wins over a bare venv; between tools, `pdm` > `poetry` > `uv`.
  - Never mix tools in one project (no `pip install` beside poetry/uv/pdm, no `uv add` in a pdm project) and never fall back to the system interpreter while a detected environment exists.
- Greenfield default remains `pdm`. New projects use `pyproject.toml` exclusively (no `setup.py`/`setup.cfg`), virtualenv mode enabled, lockfile (`pdm.lock`) committed.
- PDM scripts defined under `[tool.pdm.scripts]`:
  - `lint` - `ruff check src`
  - `format` - `ruff format src`
  - `typecheck` - `pyrefly check`
  - `test` - `pytest`
  - `dev` - `python -m src.index`
- Checks run through the detected runner regardless of tool: `lint` (`ruff check src`), `format` (`ruff format src`), `typecheck` (`pyrefly check`), `test` (`pytest`) - e.g., `pdm run test`, `poetry run pytest`, `uv run pytest`, or `<venv>\Scripts\python.exe -m pytest` for a bare venv.
- Tool role split (Pylance / Pyrefly / Ruff) so the three tools do not duplicate work or fight each other in the editor or CI:
  - **Pylance** is the language server / IntelliSense. Configure in the target repo's `.vscode/settings.json`: `python.languageServer: "Pylance"`, `python.analysis.typeCheckingMode: "strict"`. Do not enable Pylance's own type checker when Pyrefly is in use; Pyrefly is the single source of type errors.
  - **Pyrefly** is the type checker. Configure in `pyproject.toml [tool.pyrefly]`; CLI entry point is `pyrefly check`. Run on save in the editor; full check in CI and pre-commit.
  - **Ruff** is the lint + format + isort tool (single binary replaces flake8, black, and isort). Configure in `pyproject.toml [tool.ruff]` and `[tool.ruff.lint]` with a sensible default like `select = ["E", "F", "I", "W", "B", "UP"]`. Editor: `charliermarsh.ruff` extension, `[python].editor.defaultFormatter = "charliermarsh.ruff"`, `formatOnSave = true`, `editor.codeActionsOnSave.source.organizeImports = "explicit"` so Ruff handles isort without a separate extension.
  - **Recommended `.vscode/extensions.json`** `recommendations`: `ms-python.vscode-pylance`, `meta.pyrefly`, `charliermarsh.ruff`. The prompt system does not ship `.vscode/` files; PATCH runs apply this wiring to target repos on demand.
- Pyrefly is the type checker (not Pyright or mypy). Configured in `[tool.pyrefly]` in `pyproject.toml` with `strict = true`. Override noisy strict rules only with rationale. Per-file opt-out via `# pyrefly: ignore[rule]` with a one-line why comment.
- DI container: **dependency-injector**. Favor constructor injection; wire the composition root at the application entry point. Default to transient lifetime unless a clear singleton or scoped rationale exists.
- Result pattern library: **rustico** with the `safe()` convention:
  - A project-level `safe()` helper wraps a throwing expression into a `Result`:

    ```python
    from rustico import Ok, Err, Result
    from typing import Callable, TypeVar

    T = TypeVar("T")

    def safe(fn: Callable[[], T]) -> Result[T, Exception]:
        try:
            return Ok(fn())
        except Exception as e:
            return Err(e)
    ```

  - Usage: `result = safe(lambda: risky_op())` wraps a single expression.
  - Caller narrows with `if result.is_ok()` / `elif result.is_err()` or `match/case`.
  - **No `.map()`, `.and_then()`, `.or_else()`, `.inspect()`, `.match()` method chaining allowed.**
  - `.unwrap()` / `.unwrap_or()` only at boundary points where exiting the Result pattern into exception land.
  - Do not mix `rustico` with another result library in the same project.
- Preferred typed library stack (fully typed, reduce manual code):
  - Validation/models: **Pydantic v2** for API boundaries; `@dataclass(slots=True)` for internal data.
  - HTTP: **httpx** (fully typed, async).
  - CLI: **typer** (typed via annotation inference).
  - ORM: **SQLAlchemy 2.0** with `Mapped[]` syntax.
  - Lint/format: **ruff** (single binary, replaces flake8/black/isort).
  - Testing: **pytest** + **pytest-asyncio**.
  - Prefer libs that ship `py.typed` marker or have typeshed stubs over untyped alternatives.
- Linting: `ruff` (lint + format) or `black + isort + flake8`; pre-commit hooks run them on save.

## Stack: Java

- Write idiomatic Java following the Google Java Style Guide.
- Java 21 LTS minimum; records and sealed classes for value types and restricted hierarchies.
- Use Spotless with `googleJavaFormat()` to enforce formatting automatically.
- Prefer constructor injection via Dagger/Hilt over field injection.
- Prefer immutable objects; mark fields `final` by default.
- Naming: PascalCase for classes/interfaces, camelCase for methods/fields, UPPER_SNAKE_CASE for constants.
- Imports: no wildcard imports; explicit imports only.
- Errors: typed exceptions; checked exceptions for recoverable conditions, unchecked for programming errors; never swallow.
- Streams: `stream()` for transformations, but a `for` loop is fine for side effects; no nested streams (S3).
- Tests: JUnit 5; `@DisplayName` for human-readable test names; one assertion focus per test.
- Build: Maven or Gradle; wrapper committed; lockfile equivalent (`maven.lock` or `gradle.lockfile`) for reproducible builds.
- Linting: Spotless or Checkstyle; pre-commit hook runs it on save.

## Stack: Frontend (Vue / Svelte / general)

- Use semantic HTML5.
- Prefer utility-first class naming in kebab-case.
- Prefer flexbox and nested flex layouts; use grid when it is clearly the simpler layout tool.
- Prefer gap and padding over margin for layout spacing.
- For interactive elements in app UIs, prefer stable `data-testid` values in kebab-case when the project uses Playwright or similar tooling.
- Vue 3 composition API with `<script setup lang="ts">`; props typed via `defineProps<{ ... }>()`; emits typed via `defineEmits<{ ... }>()`.
- Svelte 5 runes (`$state`, `$derived`, `$effect`); props typed via `let { x }: { x: number } = $props()`.
- CSS: scoped styles; CSS custom properties for theming; no inline styles except for dynamic values.
- State: Pinia (Vue) or stores (Svelte); never component-to-component mutation through props drilling more than one level.
- Accessibility: ARIA only when semantic HTML cannot express the relationship; keyboard navigation for every interactive element; `prefers-reduced-motion` respected.

## Stack: PowerShell

- Runtime: pwsh 7.6. Never author for Windows PowerShell 5.1.
- Approved verbs (`Get-`, `Set-`, `New-`, `Remove-`, `Test-`, `Start-`, `Stop-`); `Update-` only when no approved verb fits and the deviation is documented.
- Cmdlet naming: singular noun, not plural; parameter names hyphenated (`-Path`, not `-FilePath`).
- Error handling: `$ErrorActionPreference = 'Stop'` at the top of scripts; `try/catch/finally`; never silently `continue` on a non-zero exit code.
- Native commands (git, robocopy, rg) report failure through `$LASTEXITCODE`, not exceptions: by default a non-zero exit code sets `$?` to `$false` but does not generate an error and does not trigger `catch`/`trap`.
- pwsh 7.3 (experimental) / 7.4 (stable) adds `$PSNativeCommandUseErrorActionPreference`, default `$false`. With `$true` and `$ErrorActionPreference='Stop'`, a non-zero exit code becomes a catchable script-terminating error (`NativeCommandExitException`). Whether `try/catch` fires around a native call is configuration-dependent; check both variables before relying on it; never assume.
- Prefer guard-and-return: run the command, check `$LASTEXITCODE`, write a warning, return. It is version-proof and setting-proof, and matches the dominating idiom of this repo's scripts (see the comment in `sync.ps1` `Update-GitTarget`).
- Beware informational exit codes: robocopy uses 1-7 for success outcomes; test `-ge 8` as `sync.ps1` does.
- Use `try/catch/finally` for cmdlet terminating errors and for cleanup that must run when a terminating error occurs (`finally` always runs). Under guard-and-return, restore env-var guards immediately after the guarded call; no `finally` is needed because nothing throws on that path.
- Since pwsh 7.2, `2>&1`-redirected native stderr is no longer affected by `$ErrorActionPreference`; the 5.1-era "stderr becomes terminating under Stop" hazard does not apply to pwsh.
- Output: `Write-Host` for user-facing messages, `Write-Output` (or implicit) for pipeline data, `Write-Verbose` for diagnostics. Never `Write-Host` for data the caller needs to consume.
- Modules: `Export-ModuleMember` for explicit public surface; `using module` (not `Import-Module` inline) when the module is a class library.
- Tests: Pester with `Describe`/`Context`/`It`; `Should -Be` / `Should -Throw` / `Should -Invoke`; mock with `Mock`.

## Stack: Pine Script

- Pine v6 or later; `indicator()` or `strategy()` declaration at the top of the script.
- Target Pine Script v5+ (`//@version=5` or newer); keep the version directive on line 1.
- Write every statement on a single physical line.
- Never break a line inside a ternary chain (`a ? b : c`) or inside a function call's argument list (`plot(`, `request.security(`, `label.new(`, ...) - Pine's continuation rules are fragile at those break points and produce `end of line without line continuation` compile errors.
- Break lines only where Pine requires them: indented block bodies for `if`, `else`, `for`, `while`, and user-defined functions (Pine is indentation-scoped like Python; use 4 spaces consistently, never mix tabs and spaces).
- When a single line grows unwieldy, refactor instead of wrapping: extract intermediate variables, or replace a long ternary with an `if`/`else` block.
- Put comments on their own line above the statement; never end a line that continues onto the next line with a `//` comment (the compiler rejects it).
- Existing multi-line Pine code keeps its local convention unless reformatting is explicitly approved.
- Naming: PascalCase for functions and types, camelCase for variables, UPPER_SNAKE_CASE for constants.
- Inputs: `input.int`, `input.float`, `input.bool`, `input.string`, `input.color`, `input.timeframe` with explicit `title=` and `tooltip=`.
- Plots: `plot` only after `indicator()`; `plotshape` for markers; `bgcolor` for context bands.
- Errors: `runtime.error()` for unrecoverable conditions; `assert` only for invariant checks; never swallow `runtime.error`.
- Performance: no `for` loops over `bar_index` ranges; use built-in functions (`ta.crossover`, `ta.highest`) for O(1) equivalents.
- Testing: TradingView's built-in strategy tester for backtests; manual visual inspection for indicator behavior.

## Stack: Database

- Schema design: 3NF minimum, denormalize only with documented reason; every foreign key has a matching index.
- Target: 3NF normalization. Every table has a single-column `INTEGER` primary key named `id`. Denormalization requires explicit rationale.
- Table names are singular `snake_case`. Foreign keys are `[singular_table]_id`. Indexes named `idx_[table]_[columns]`. No prefixes or suffixes.
- Naming: snake_case for tables and columns; plural table names (`users`, not `user`); singular column names for scalar fields.
- Type subset (cross-database compatible): `INTEGER`, `TEXT`, `BOOLEAN`, `REAL`. No `SERIAL`, `AUTO_INCREMENT`, `VARCHAR(n)`, `BIGINT`, `SMALLINT`, `TINYINT`, `NUMERIC`, or `DECIMAL`. Use `TEXT` with `CHECK (length(col) <= n)` for varchar semantics.
- Timestamps are `TEXT` storing Unix epoch seconds as strings. Named `created_at`, `updated_at`, `deleted_at`.
- Every column explicit `NOT NULL` or nullable. `BOOLEAN` columns must be `NOT NULL DEFAULT false`.
- Migrations: forward-only, one change per migration, named with timestamp + description; never edit a migration after it has been applied.
- Indexes: every foreign key, every column referenced in `WHERE` for non-trivial queries, every column used in `ORDER BY` for sort. Every foreign key must have an explicit index. Add indexes for `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY` columns on tables over ~1k rows.
- Queries: parameterized only; no string concatenation; `EXPLAIN ANALYZE` reviewed for queries over 100ms.
- Transactions: every multi-statement write wraps in a transaction; isolation level chosen explicitly, not defaulted. Neither SQLite nor Postgres supports unsigned integers natively - use `CHECK (col >= 0)` for non-negative constraints.
