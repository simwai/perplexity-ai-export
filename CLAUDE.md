# CLAUDE.md

@AGENTS.md

If the import above did not expand in your client, read `AGENTS.md` at the
repo root and follow it as the agent entry point, then load
`prompt-system/00-system.md` (orchestrator + routing + hard guards) per the load
order in `AGENTS.md` `## Loading the Full Spec`.

**Startup**: Run `ls prompt-system/*.md` to discover all system files, then read
each in full per `00-system.md`'s `## Load order`. The fingerprint gate is
enforced by the STARTUP phase in `00-system.md`.
