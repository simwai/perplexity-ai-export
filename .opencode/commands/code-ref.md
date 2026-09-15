---
description: Look up a high-quality code reference from the curated global pool.
---

Look up references from the global reference pool at `~/.config/opencode/reference-pool/`. If the pool is not initialized, run `prompt-system/scripts/init-reference-pool.ps1` first.

## Arguments

Parse `$ARGUMENTS` for these flags:

- `--language <lang>` - required. Example: `typescript`, `python`, `java`, `csharp`
- `--domain <domain>` - required. Example: `config-validation`, `error-handling`, `auth`
- `--keywords <kw1,kw2>` - required. Comma-separated search keywords
- `--pool <pool-id>` - optional. Restrict results to a specific pool member
- `--refresh` - optional. Run the refresh script instead of lookup

## Retrieval mode (default)

1. Load `prompt-system/scripts/retrieve-reference.ps1`
2. Call `Get-ReferencePoolMatches` with the parsed parameters
3. For each result returned:
   - Read the full cached file from disk: `~/.config/opencode/reference-pool/{language}/{author-repo}/{file-path}`
   - Include in your response: author, repo, trust level, why-added note, file path in pool, match score and reason, and the full file content
4. Return up to 3 matches, ranked by score

If no matches are found, say so plainly and suggest broadening the keywords or checking the pool manifest.

## Refresh mode

When `--refresh` is present:

1. Run `prompt-system/scripts/refresh-reference-pool.ps1`
2. Report how many entries were refreshed, skipped, or failed

## Curation

When the user asks to add a reference (e.g. "add this to the pool", "cache this file", "reference this"):

1. Identify the source: a GitHub URL, local file path, or code snippet
2. For a GitHub URL:
   - Run `prompt-system/scripts/add-reference.ps1` with the URL, language, domain, keywords, and why-note
   - Confirm what was added: pool member, entry ID, cached file path, commit
3. For a local file or snippet:
   - Ask the user for the source GitHub URL if they want it cached with provenance
   - If they just want it stored locally, save it to `~/.config/opencode/reference-pool/{language}/{author-repo}/{filename}` and note that it lacks upstream provenance

## Rules

- Never fabricate pool entries or fake source URLs
- Always read the full cached file before presenting it as a reference
- If the pool is empty or uninitialized, say so and offer to run the init script
- The pool is user-global; do not commit it or push it anywhere
