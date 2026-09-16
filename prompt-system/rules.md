# General Rules

All principles from `05-impl-style.md` (General principles, Design heuristics, Stepdown/Newspaper/Flag args/Law of Demeter) and soft-tier rubrics from `04-rubrics.md`, converted to mechanically enforceable hard-gate rules.

Each rule has:
- **Principle** - the source rule or heuristic
- **Hard gate** - the H-number in `04-rubrics.md`
- **Detection** - how the system mechanically detects the violation
- **Enforcement** - what the system does when triggered
- **Auto-exception** - system-calculated conditions that automatically downgrade the rule
- **Scope matrix** - mandatory or advisory per scope (bugfix/feature/refactor)

---

## H13 -- No Duplication

**Principle:** DRY - don't repeat logic that exists elsewhere in the codebase.

**Hard gate:** H13

**Detection:**
- System compares new code blocks against `existing_utilities` from Discovery Protocol
- Match threshold: ≥3 consecutive lines of structurally identical logic
- Detection method: `rg` for duplicated block patterns in target file vs. known utilities

**Enforcement:** Block if fix introduces logic duplicated from existing utility. Verification gate runs `rg` for the duplicated pattern; if found, gate FAIL.

**Auto-exception:**
- Duplication is < 3 lines
- Existing utility is in a different architectural layer
- Existing utility is deprecated
- Duplication is a standard boilerplate required by framework (e.g., React component structure)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H14 -- Library-First

**Principle:** Use an already-installed dependency before hand-rolling. Code-decision ladder rung 5.

**Hard gate:** H14

**Detection:**
- System inspects new code for hand-rolled implementations of common concerns
- System cross-references `available_libraries` from Discovery Protocol
- Match: hand-rolled code addresses a concern that an available library solves

**Enforcement:** Block if fix hand-rolls logic that a maintained library solves. Verification gate checks for library usage; if absent, gate FAIL.

**Auto-exception:**
- Hand-rolled code < 50 lines AND library would add a new dependency
- Library is unmaintained (no releases in >12 months)
- Library adds >100KB to bundle size
- Hand-rolled code is a standard adapter/wrapper that the project already maintains

**Scope matrix:**
- bugfix: advisory
- feature: mandatory
- refactor: mandatory

---

## H15 -- Ownership Routing

**Principle:** Route through the architectural owner of a concern. Don't bypass the module that owns the validation, error handling, or business logic.

**Hard gate:** H15

**Detection:**
- System identifies `pattern_owner` from Discovery Protocol (highest reference count + import count)
- System verifies fix calls the owner module's method
- Detection method: `rg` for owner module method call in target file after patch

**Enforcement:** Block if fix bypasses the architectural owner. Verification gate checks for owner module usage; if absent, gate FAIL.

**Auto-exception:**
- Owner module is deprecated
- Owner has high coupling flag (fan-in + fan-out > 20)
- Owner is in a different service boundary (monorepo sibling)
- Target is the owner module itself
- Owner module is a test fixture or composition root

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H16 -- Layer Discipline

**Principle:** Respect architectural layer boundaries. Controllers must not contain business logic. Services must not access the database directly.

**Hard gate:** H16

**Detection:**
- System classifies target file by layer (controller, service, repository, component, hook, utility, etc.)
- System identifies forbidden patterns for that layer from `layer_rules` in Discovery Protocol
- Detection method: `rg` for forbidden patterns in target file after patch

**Enforcement:** Block if fix violates layer boundaries. Verification gate checks for forbidden patterns; if found, gate FAIL.

**Auto-exception:**
- Target file is a composition root
- Target is an integration/adapter layer
- Forbidden pattern is a framework-mandated pattern (e.g., ORM model methods)
- Existing code in same file already violates the layer rule

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H17 -- No Single-Use Abstraction

**Principle:** YAGNI. Don't create abstractions that are used only once. A factory with one product, an interface with one implementation, or a helper called from one place is speculative.

**Hard gate:** H17

**Detection:**
- System identifies new functions/classes/modules added by the fix
- After patch: `rg` for new symbol name across codebase
- Count callers outside the defining file
- If callers ≤ 1: flag

**Enforcement:** Block if fix creates a new abstraction with ≤1 caller. Verification gate counts callers; if ≤1, gate FAIL.

**Auto-exception:**
- Abstraction is a public API surface
- Abstraction is a factory/wrapper used by ≥3 call sites within same file
- Abstraction is a test helper
- Abstraction is a framework-mandated lifecycle method (e.g., React `useEffect`)
- Abstraction is a deliberate extension point with documented planned subtypes

**Scope matrix:**
- bugfix: advisory
- feature: mandatory
- refactor: mandatory

---

## H18 -- Dominant Idiom Enforcement

**Principle:** Don't introduce a new pattern when a dominant pattern already exists. The fix should follow the established idiom of the file and codebase.

**Hard gate:** H18

**Detection:**
- System identifies `dominant_idiom` from Discovery Protocol (most frequent pattern by count)
- System compares fix's idiom against dominant idiom
- Detection method: `rg` for non-conforming pattern in target file after patch

**Enforcement:** Block if fix introduces a new pattern when dominant pattern exists with high confidence. Verification gate checks for dominant idiom usage; if absent, gate FAIL.

**Auto-exception:**
- No dominant pattern exists (first implementation of this concern)
- Dominant pattern confidence is low (reference count margin < 2x)
- Dominant pattern is in a deprecated module
- Target file already uses a different pattern (local idiom overrides codebase idiom)
- Fix is migrating from one pattern to another (documented migration)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H19 -- No Over-Engineering

**Principle:** KISS. Don't create unnecessary abstraction layers. A function that does one thing doesn't need a strategy pattern, a factory, and an interface.

**Hard gate:** H19

**Detection:**
- System counts abstraction layers added by the fix (new interfaces, base classes, factories, registries)
- System counts callers of new abstractions
- If abstraction layers > 1 AND callers < 3: flag

**Enforcement:** Block if fix creates unnecessary abstraction layers. Verification gate checks abstraction depth and caller count; if layers > 1 and callers < 3, gate FAIL.

**Auto-exception:**
- Abstraction has clear extension points (abstract base with planned subtypes)
- Abstraction simplifies ≥3 call sites
- Abstraction is a framework-mandated pattern (e.g., middleware chain)
- Abstraction is a public API surface with versioning implications

**Scope matrix:**
- bugfix: advisory
- feature: mandatory
- refactor: mandatory

---

## H20 -- Composition Over Inheritance

**Principle:** Prefer composition over class inheritance. Use dependency injection and object composition instead of extending base classes.

**Hard gate:** H20

**Detection:**
- System counts `extends` usage in target layer vs. composition usage
- If composition is dominant (>60% of similar patterns) AND fix uses `extends`: flag
- Stack-specific: TypeScript/JS (`extends`), Python (`class Child(Parent)`), Java (`extends`)

**Enforcement:** Block if fix uses inheritance when composition is dominant in the layer. Verification gate checks for `extends` in new code; if composition is dominant, gate FAIL.

**Auto-exception:**
- Dominant pattern in same layer uses inheritance
- Target is a framework-mandated inheritance case (React component, Exception class, TestCase)
- Inheritance is a standard library pattern (e.g., `Error` subclass)
- Composition would require >3 additional lines of glue code

**Scope matrix:**
- bugfix: advisory
- feature: mandatory
- refactor: mandatory

---

## H21 -- Dependency Injection

**Principle:** Use dependency injection over hidden construction. Don't use `new` outside the composition root.

**Hard gate:** H21

**Detection:**
- System identifies composition root files from Discovery Protocol
- System checks for `new` keyword usage in target file
- If target is not composition root AND contains `new`: flag

**Enforcement:** Block if fix uses `new` or direct instantiation outside composition root. Verification gate checks for `new` in target file; if outside composition root, gate FAIL.

**Auto-exception:**
- Target is composition root itself
- Target is a test fixture
- Target is a factory method (explicit creation function)
- `new` is used for standard library objects (Date, Map, Set, etc.)
- `new` is used for value objects/DTOs (no dependencies)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H22 -- Single Source of Truth

**Principle:** Don't duplicate config, constants, or data that exists in a single source. One source of truth; references everywhere else.

**Hard gate:** H22

**Detection:**
- System identifies config files, constant files, and data files from Discovery Protocol
- System checks for literal values in new code that match existing config/constants
- Detection method: `rg` for literal values that match existing single-source entries

**Enforcement:** Block if fix duplicates config/data that exists in a single source. Verification gate checks for duplicated literals; if found, gate FAIL.

**Auto-exception:**
- Duplicate is a fallback for missing config
- Duplicate is a stack-specific override (e.g., environment-specific value)
- Duplicate is a standard constant (0, 1, true, false, empty string)
- Duplicate is a timeout/retry count that varies by context

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H23 -- Early Returns

**Principle:** Prefer early returns over deep nesting. A function should not have >3 levels of indentation.

**Hard gate:** H23

**Detection:**
- System counts nesting depth in modified functions
- If nesting depth > 3 AND no early return exists: flag
- Detection method: parse function body for indentation levels

**Enforcement:** Block if fix introduces deep nesting (>3 levels) without early returns. Verification gate checks nesting depth; if >3 and no early return, gate FAIL.

**Auto-exception:**
- Deep nesting is a guard clause for a single error path
- Existing function in same file uses deep nesting (local idiom overrides)
- Deep nesting is a switch/match statement (legitimate control flow)
- Deep nesting is a try/catch block (exception handling)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H24 -- No Unnecessary Abstraction

**Principle:** Don't create abstractions for a single use case. A wrapper that's called once is not an abstraction; it's indirection.

**Hard gate:** H24

**Detection:**
- Overlaps with H17 (single-use abstraction)
- Specifically targets wrappers, adapters, and delegators with single callers
- System counts callers of new wrapper/adapter/delegator functions

**Enforcement:** Block if fix creates a wrapper/adapter/delegator with ≤1 caller. Verification gate counts callers; if ≤1, gate FAIL.

**Auto-exception:**
- Wrapper is a public API surface
- Wrapper simplifies ≥3 call sites
- Wrapper is a framework-mandated pattern (e.g., React hook wrapper)
- Wrapper is a test helper

**Scope matrix:**
- bugfix: advisory
- feature: mandatory
- refactor: mandatory

---

## H25 -- No Speculative Code

**Principle:** Don't include code for concerns not present in the task scope. A parameter that's never read, a branch that's unreachable, or a feature flag for a planned feature is speculative.

**Hard gate:** H25

**Detection:**
- System checks for `TODO` without owner/target
- System checks for parameters that are never read in the function body
- System checks for branches that are always false/true (constant conditions)
- Detection method: `rg` for `TODO` without owner, unreachable code patterns

**Enforcement:** Block if fix includes speculative code. Verification gate checks for TODOs without owner, unused parameters, unreachable branches; if found, gate FAIL.

**Auto-exception:**
- Speculative code is marked `TODO` with owner and target
- Speculative code is a parameter that enables a planned feature within 30 days
- Speculative code is a feature flag for A/B testing (documented)
- Speculative code is a debug log that will be removed before merge (marked `TODO`)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H26 -- No Manual-Sync Registries

**Principle:** Avoid registries or mappings that require manual sync when dynamic discovery is simpler and safer.

**Hard gate:** H26

**Detection:**
- System identifies registry/mapping patterns in new code
- System checks if entries match actual discovered items (static list vs. dynamic discovery)
- Detection method: `rg` for registry pattern; compare entries against actual files/modules

**Enforcement:** Block if fix creates a registry/mapping that requires manual sync. Verification gate checks if registry entries match discovered items; if mismatch, gate FAIL.

**Auto-exception:**
- Registry is auto-generated from discovery
- Registry has ≤5 entries
- Dynamic discovery would add needless complexity
- Registry is a standard framework feature (e.g., route table, plugin registry)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: mandatory

---

## H27 -- No Over-Engineered Discovery

**Principle:** Keep explicit lists when discovery would add needless complexity or reduce clarity.

**Hard gate:** H27

**Detection:**
- System counts items in explicit list vs. complexity of discovery mechanism
- If explicit list has <10 items AND discovery mechanism is >3 lines: flag
- Detection method: `rg` for discovery patterns, count list items

**Enforcement:** Block if fix uses dynamic discovery when explicit list is simpler. Verification gate checks list size vs. discovery complexity; if list <10 and discovery >3 lines, gate FAIL.

**Auto-exception:**
- Explicit list has >10 items
- Discovery is a standard library feature
- Discovery is a framework-mandated pattern
- Explicit list would require manual sync (H26 takes precedence)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H28 -- Code-Decision Ladder Compliance

**Principle:** Before writing new code, check: does this already exist? Does the standard library do it? Does an installed dependency solve it? Only then write new code.

**Hard gate:** H28

**Detection:**
- For each new function/class/module: `rg` for similar utility in codebase, standard lib, and installed deps
- If match found with >80% similarity: flag
- Detection method: `rg` for similar function signatures, class names, utility patterns

**Enforcement:** Block if fix adds new code when existing utility/library/standard lib already solves it. Verification gate checks for existing solutions; if found, gate FAIL.

**Auto-exception:**
- Existing utility doesn't cover the exact use case
- Using existing utility would require >3 additional lines of glue code
- Existing utility is deprecated
- Existing utility is in a different layer/service boundary

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H29 -- Stepdown Rule

**Principle:** Functions read top-to-bottom. Each function calls functions one level of abstraction below it. A function whose first line is a high-level call and whose next line is a low-level call without a named intermediate violates the stepdown rule.

**Hard gate:** H29

**Detection:**
- System analyzes function body: if first line is high-level call and second line is low-level call without intermediate, flag
- High-level calls: domain operations, business logic
- Low-level calls: I/O, parsing, formatting, system calls
- Detection method: parse function body for call sequence

**Enforcement:** Block if fix mixes high-level orchestration with low-level operations without named intermediate. Advisory only - flags in REVIEW, doesn't block.

**Auto-exception:**
- Existing function in same file violates stepdown
- Low-level call is a one-liner (e.g., `return json.dumps(data)`)
- Low-level call is a standard library function with no side effects
- Function is a test helper (different standards apply)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H30 -- Newspaper Order

**Principle:** A file reads like a newspaper article: public API first, private details later. A public function should not appear below a private helper it calls.

**Hard gate:** H30

**Detection:**
- For each public function: `rg` for private helper definitions that appear later in the file
- If public function calls a helper defined below it: flag
- Detection method: parse file for function definition order and call references

**Enforcement:** Block if fix places public function below private helper it calls. Advisory only - flags in REVIEW, doesn't block.

**Auto-exception:**
- File already violates newspaper order
- Helper is a closure inside the public function
- Helper is a type definition or interface (not a function)
- File is a test file (different organization standards)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H31 -- No Flag/Output Arguments

**Principle:** A function should not take a boolean flag that selects between two behaviors, nor mutate an argument passed by reference instead of returning a value.

**Hard gate:** H31

**Detection:**
- System checks new function signatures for boolean parameters
- System checks for output argument patterns (mutating passed-in objects)
- Detection method: `rg` for boolean parameters, output argument patterns in new code

**Enforcement:** Block if fix introduces boolean flag arguments or mutates output arguments. Verification gate checks signatures; if found, gate FAIL.

**Auto-exception:**
- Flag is a framework-mandated parameter (e.g., React `useEffect` deps array)
- Flag is a configuration option with semantic meaning (e.g., `recursive: boolean`)
- Mutation is a fluent builder return value
- Mutation is a standard library pattern (e.g., `Array.sort()` in-place)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H32 -- Law of Demeter

**Principle:** A method should not reach through another object to access its parts. A chain of more than one dot (`a.b.c.d`) is a Demeter violation unless it's a fluent builder or DTO.

**Hard gate:** H32

**Detection:**
- System checks new code for dot chains with >2 dots
- Exceptions: fluent builder return values, DTO access, standard library chaining
- Detection method: `rg` for dot chains with >2 dots in new code

**Enforcement:** Block if fix introduces train-wreck method chains. Advisory only - flags in REVIEW, doesn't block.

**Auto-exception:**
- Chain is a fluent builder return value
- Chain is a data-transfer object (DTO)
- Existing code in same file uses train-wreck
- Chain is a standard library pattern (e.g., `lodash.get(obj, 'a.b.c')`)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H33 -- No Dead Code

**Principle:** Don't add unreachable code or unused exports. Dead code increases maintenance burden and confusion.

**Hard gate:** H33

**Detection:**
- System checks for new exports that have no callers
- System checks for return statements followed by code
- System checks for branches that are always false/true
- Detection method: `rg` for new exports, unreachable code patterns

**Enforcement:** Block if fix adds unreachable code or unused exports. Verification gate checks for dead code; if found, gate FAIL.

**Auto-exception:**
- Unreachable code is a deliberate sentinel/guard
- Unused export is part of a public API
- Unreachable code is a test assertion that's always evaluated
- Unused export is re-exported for public API surface

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H34 -- No Magic Values

**Principle:** Unexplained literals should be named constants. A magic number like `86400` or a magic string like `"prod"` should have a name.

**Hard gate:** H34

**Detection:**
- System checks for numeric/string literals in new code
- If literal is not already defined as a constant in the same file: flag
- Exceptions: standard constants (0, 1, true, false, empty string), literals that appear ≥3 times in same function
- Detection method: `rg` for numeric/string literals in new code

**Enforcement:** Block if fix introduces unexplained literals that should be named constants. Advisory only - flags in REVIEW, doesn't block.

**Auto-exception:**
- Literal is a standard constant (0, 1, true, false, empty string)
- Literal appears ≥3 times in the same function (local convention)
- Literal is a standard unit conversion (e.g., `1000` for milliseconds)
- Literal is a standard format string (e.g., `"%Y-%m-%d"`)

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## H35 -- Error Handling Quality

**Principle:** Don't swallow exceptions or lose error context. Every catch block must either re-raise, return a Result, or log with context.

**Hard gate:** H35

**Detection:**
- System checks for `catch` blocks in new code
- If catch body is empty, bare `pass`, or logs without context: flag
- Detection method: `rg` for catch blocks in new code; analyze body

**Enforcement:** Block if fix swallows exceptions or loses error context. Verification gate checks catch blocks; if empty or context-less, gate FAIL.

**Auto-exception:**
- Catch block re-raises or returns a Result
- Catch is in test code (test assertions may deliberately swallow)
- Catch logs with structured context (error code, request ID, etc.)
- Catch is a deliberate no-op with documented reason

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H36 -- Logging Quality

**Principle:** Don't add debug prints or expose sensitive data in logs. Use semantic logging with appropriate levels.

**Hard gate:** H36

**Detection:**
- System checks for debug print statements in new code
- System checks for sensitive data patterns in log statements (passwords, tokens, PII)
- Detection method: `rg` for `console.log`, `print`, `Write-Host`, `printf` in new code; `rg` for sensitive data patterns near log statements

**Enforcement:** Block if fix adds debug prints or exposes sensitive data in logs. Verification gate checks for debug prints and sensitive data; if found, gate FAIL.

**Auto-exception:**
- Debug prints are in test code
- Debug prints are marked `TODO` for removal
- Log statement uses structured logging with appropriate level (debug/info/warn/error)
- Sensitive data is redacted or masked in log output

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H37 -- Type Safety (Non-Python)

**Principle:** Don't use unsafe casts, `any` type, or `as` without type guard. Type safety is a first-class concern.

**Hard gate:** H37

**Detection:**
- System checks for `any` type usage in new code
- System checks for `as` casts without `@ts-expect-error` or type guard
- Detection method: `rg` for `any`, `as ` without `@ts-expect-error` in new code

**Enforcement:** Block if fix uses unsafe casts or `any` type. Verification gate checks for type safety violations; if found, gate FAIL.

**Auto-exception:**
- Cast is marked `@ts-expect-error` with reason
- `any` is in test code (test mocks may use `any`)
- Cast is a standard library pattern (e.g., `as unknown as Type`)
- `any` is used for third-party library types without declarations

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## H38 -- No Obvious Performance Issues

**Principle:** Don't introduce O(n²) scans, nested loops over same data, or synchronous blocking in async context.

**Hard gate:** H38

**Detection:**
- System checks for nested loops in new code
- System checks for synchronous I/O in async functions
- System checks for unbounded `reduce` or `map` operations
- Detection method: `rg` for nested loops, sync I/O in async, unbounded operations

**Enforcement:** Block if fix introduces obvious performance issues. Advisory only - flags in REVIEW, doesn't block.

**Auto-exception:**
- Data size is bounded (<100 items)
- Performance impact is measured and documented
- Nested loop is over distinct datasets (not same data)
- Synchronous I/O is a one-time startup operation
- Unbounded operation is a batch job with known input size

**Scope matrix:**
- bugfix: advisory
- feature: advisory
- refactor: advisory

---

## Rule Reference by Principle

| Principle | Hard Gate | Scope |
|---|---|---|
| DRY | H13 | all mandatory |
| KISS | H19 | feature/refactor mandatory, bugfix advisory |
| Composition over inheritance | H20 | feature/refactor mandatory, bugfix advisory |
| Dependency injection | H21 | all mandatory |
| Single source of truth | H22 | all mandatory |
| Early returns | H23 | all advisory |
| YAGNI | H17 | feature/refactor mandatory, bugfix advisory |
| No manual-sync registries | H26 | refactor mandatory, bugfix/feature advisory |
| Keep explicit lists when discovery adds complexity | H27 | all advisory |
| Code-decision ladder | H28 | all mandatory |
| Stepdown rule | H29 | all advisory |
| Newspaper order | H30 | all advisory |
| No flag/output arguments | H31 | all mandatory |
| Law of Demeter | H32 | all advisory |
| No dead code | H33 | all mandatory |
| No magic values | H34 | all advisory |
| Error handling quality | H35 | all mandatory |
| Logging quality | H36 | all mandatory |
| Type safety (non-Python) | H37 | all mandatory |
| No obvious performance issues | H38 | all advisory |
| No multi-concept files | H39 | all mandatory |

---

## H39 -- No Multi-Concept Files

**Principle:** Each distinct concept gets its own file. Do not combine multiple classes, errors, types, interfaces, or schemas into a single file.

**Hard gate:** H39

**Detection:**
- System checks for multiple class definitions in a single file
- System checks for mixed concept types in a single file (e.g., a class and an interface, or two unrelated classes)
- Detection method: `rg` for class/interface/type definitions in target file; count distinct concept types

**Enforcement:** Block if fix combines multiple concepts in one file. Verification gate checks for mixed concepts; if found, gate FAIL.

**Auto-exception:**
- File is a test file (test helpers may combine)
- File is a barrel/index file (re-exports only)
- All concepts in the file are tightly related and form a single coherent module (documented)
- Target language has no native class/interface separation (rare)

**Scope matrix:**
- bugfix: mandatory
- feature: mandatory
- refactor: mandatory

---

## Stack-Specific Variants

Stack-specific detection patterns are defined in `05-impl-style.md` per-stack sections. The system reads the stack from the project's manifest or file extensions and applies the appropriate detection patterns.

Examples:
- TypeScript: `any`, `as `, `extends`, `new`
- Python: `class Child(Parent)`, `except:` without `raise`
- Java: `extends`, `new` outside composition root
- PowerShell: `$ErrorActionPreference = 'Continue'` (swallowing errors)
