# BOOTSTRAP.md — Mandatory Startup Verification Gate

> **THIS IS THE FIRST FILE YOU MUST READ AND ACT ON.**
> **STOP — Do not emit any phase output, tool calls, or decisions until you complete the fingerprint below.**
> AGENTS.md is the sole entry point; this file supports the STARTUP gate only.

---

## Mandatory STARTUP Phase

Before ANY phase transition (including `START -> CHECKLIST`, `START -> INTAKE`, `START -> DISCUSS`, `START -> BLOCKED`), you MUST complete the STARTUP phase:

1. **Read `prompt-system/00-system.md` in FULL with NO chunking** — single read, largest window. Partial reads are a protocol breach.

2. **Emit the bootstrap fingerprint** (copy this exact format, fill in values):

```
00-system.md fingerprint: <line_count> lines, first_100_chars="<first 100 chars>", last_100_chars="<last 100 chars>", sha256_first_1kb="<hash or N/A>"
```

- `line_count`: Total lines in 00-system.md (use `wc -l` or count)
- `first_100_chars`: First 100 characters of the file (exact, including newlines)
- `last_100_chars`: Last 100 characters of the file (exact, including newlines)
- `sha256_first_1kb`: SHA256 of first 1024 bytes, or `N/A` if unavailable

**If SHA256 unavailable**: Use `N/A` explicitly. The fallback is line_count + first_100 + last_100.

3. **Discover all system files** by running `ls prompt-system/*.md`, then read every file listed in `00-system.md`'s `## Load order` in full with NO chunking:

4. **Record completion** in the session state file's `## Startup Verification` section.

---

## Host-Specific Notes

### opencode
- **Auto-enforced** by the `startup-gate` plugin (`.opencode/plugins/startup-gate.ts`)
- Plugin hooks `session.created`, injects fingerprint requirement into system prompt
- Blocks `chat.message` until valid fingerprint received
- Writes `startup_verified: true` + `startup_fingerprint` to session state
- **You do not need to manually emit fingerprint on opencode** — the plugin handles it

---

## Verification Checklist

After emitting fingerprint, confirm:
- [ ] 00-system.md read in full (single read)
- [ ] Fingerprint emitted in exact format above
- [ ] All system files loaded from `00-system.md`'s `## Load order` (full, no chunking)
- [ ] Session state `## Startup Verification` updated (if file-capable host)

---

## Protocol Breach

**Any response that emits a phase header (`[PHASE: ...]`) or `[MODE: DIRECT]` without a completed STARTUP fingerprint is a protocol breach → output `BLOCKED` with reason "STARTUP incomplete".**

---

## Session State Fields (for plugin / manual recording)

```markdown
## Startup Verification
00-system.md: [cited rule] — fingerprint: <line_count> lines, first_100_chars="<first 100 chars>", last_100_chars="<last 100 chars>", sha256_first_1kb="<hash or N/A>"
01-personas.md: [cited rule]
02-decision-prompts.md: [cited rule]
03-output-and-state.md: [cited rule]
04-rubrics.md: [cited rule]
05-impl-style.md: [cited rule]
06-misc.md: [cited rule]
07-protocols.md: [cited rule]
08-plan-actual-gate.md: [cited rule]
Status: Complete
```

---

**Remember**: This gate exists because model discipline is unreliable. The fingerprint proves you actually read 00-system.md in full. No exceptions.
