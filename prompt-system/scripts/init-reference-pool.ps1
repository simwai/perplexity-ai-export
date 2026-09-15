<#
.SYNOPSIS
    Initializes the global reference pool skeleton.
.DESCRIPTION
    Creates ~/.config/opencode/reference-pool/ with manifest.yaml template,
    language directories, and README. Idempotent: safe to run multiple times.
    Called by sync.ps1 during prompt-system sync.
#>

$ErrorActionPreference = 'Stop'

$script:POOL_ROOT = if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.config\opencode\reference-pool'
} else {
    Join-Path $env:HOME '.config\opencode\reference-pool'
}

$script:LANGUAGES = @('typescript', 'python', 'java', 'csharp')

function Ensure-ReferencePool {
    if (Test-Path -LiteralPath $script:POOL_ROOT -PathType Container) {
        Write-Host "reference-pool: already initialized at $script:POOL_ROOT" -ForegroundColor DarkGray
        return
    }

    New-Item -ItemType Directory -Path $script:POOL_ROOT -Force | Out-Null

    foreach ($lang in $script:LANGUAGES) {
        New-Item -ItemType Directory -Path (Join-Path $script:POOL_ROOT $lang) -Force | Out-Null
    }

    $manifestPath = Join-Path $script:POOL_ROOT 'manifest.yaml'
    $readmePath = Join-Path $script:POOL_ROOT 'README.md'

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $manifest = @"
schema_version: "1.0"
pool:
  - id: "example-author"
    type: "author"
    handle: "example-author"
    languages: ["typescript"]
    domains: ["config-validation"]
    trust_level: "premium"
    added_at: "$(Get-Date -Format 'yyyy-MM-dd')"
    why: "Replace with why this author/repo is trusted"

entries: []
"@
        $manifest | Set-Content -LiteralPath $manifestPath -Encoding UTF8
        Write-Host "reference-pool: created manifest.yaml" -ForegroundColor Green
    }

    if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) {
        $readme = @"
# Reference Pool

Curated full-file references from trusted GitHub authors and repos.

## Structure

- `manifest.yaml` - pool members and file entries
- `{language}/{author-repo}/{file-path}` - cached full files

## Curation

Use `add-reference.ps1` to add files. Use `refresh-reference-pool.ps1` to update entries older than 1 month.

## Schema

See manifest.yaml for the current schema_version and example entries.
"@
        $readme | Set-Content -LiteralPath $readmePath -Encoding UTF8
        Write-Host "reference-pool: created README.md" -ForegroundColor Green
    }

    Write-Host "reference-pool: initialized at $script:POOL_ROOT" -ForegroundColor Green
}

Ensure-ReferencePool
