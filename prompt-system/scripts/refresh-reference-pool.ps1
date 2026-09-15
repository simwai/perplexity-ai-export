<#
.SYNOPSIS
    Refreshes reference pool entries older than 1 month.
.DESCRIPTION
    Scans the manifest for entries whose added_at is older than the TTL,
    re-fetches them from GitHub, updates the cached files and manifest.
    Does not touch entries newer than the TTL.
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$script:POOL_ROOT = if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.config\opencode\reference-pool'
} else {
    Join-Path $env:HOME '.config\opencode\reference-pool'
}

$script:MANIFEST_PATH = Join-Path $script:POOL_ROOT 'manifest.yaml'
$script:TTL_DAYS = 30

function Test-PoolInitialized {
    if (-not (Test-Path -LiteralPath $script:POOL_ROOT -PathType Container)) {
        throw "Reference pool not initialized at $script:POOL_ROOT. Run init-reference-pool.ps1 first."
    }
    if (-not (Test-Path -LiteralPath $script:MANIFEST_PATH -PathType Leaf)) {
        throw "manifest.yaml not found at $script:MANIFEST_PATH"
    }
}

function Parse-GitHubUrl {
    param([string]$Url)
    
    if ($Url -match '^https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$') {
        return @{
            Owner = $matches[1]
            Repo = $matches[2]
            Branch = $matches[3]
            Path = $matches[4]
            RawUrl = $Url
        }
    }
    
    if ($Url -match '^https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$') {
        $owner = $matches[1]
        $repo = $matches[2]
        $branch = $matches[3]
        $path = $matches[4]
        $rawUrl = "https://raw.githubusercontent.com/$owner/$repo/$branch/$path"
        return @{
            Owner = $owner
            Repo = $repo
            Branch = $branch
            Path = $path
            RawUrl = $rawUrl
        }
    }
    
    throw "Unsupported GitHub URL format: $Url"
}

function Get-CurrentCommit {
    param(
        [string]$Owner,
        [string]$Repo,
        [string]$Branch,
        [string]$Path
    )
    
    $apiUrl = "https://api.github.com/repos/$Owner/$Repo/commits?path=$Path&sha=$Branch&per_page=1"
    
    $headers = @{}
    $ghToken = $env:GITHUB_TOKEN
    if ($ghToken) {
        $headers['Authorization'] = "token $ghToken"
        $headers['User-Agent'] = 'reference-pool'
    }
    
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Get -ErrorAction Stop
        if ($response -and $response.Count -gt 0) {
            return $response[0].sha
        }
    } catch {
        # Rate limit or network issue - skip this entry
    }
    return $null
}

function Read-Manifest {
    param([string]$Path)
    
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if (-not $content) { return @{ schema_version = ''; pool = @(); entries = @() } }
    
    $lines = $content -split "`n"
    $result = @{ schema_version = ''; pool = @(); entries = @() }
    $currentSection = ''
    $inList = $false
    $currentItem = @{}
    $listKey = ''
    $nestDepth = 0
    $nestKey = ''
    $listKeys = @('pool', 'entries')
    
    foreach ($line in $lines) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*$') { continue }
        
        if ($line -match '^([a-z_]+):\s*(.*)$') {
            $key = $matches[1]
            $value = $matches[2].Trim()
            
            if ($currentSection -and $inList -and $currentItem.Count -gt 0) {
                if ($listKey -eq 'pool') { $result.pool += $currentItem }
                elseif ($listKey -eq 'entries') { $result.entries += $currentItem }
                $currentItem = @{}
            }
            $inList = $false
            $nestDepth = 0
            
            if ($value -eq '[' -or $value -match '^\[.*\]$') {
                if ($value -match '^\[(.+)\]$') {
                    $inner = $matches[1]
                    $items = $inner -split ',\s*' | ForEach-Object { $_.Trim().Trim('"', "'") }
                    if ($key -eq 'languages' -or $key -eq 'domains' -or $key -eq 'primary_tags' -or $key -eq 'secondary_tags') {
                        $currentItem[$key] = $items
                    } elseif ($key -eq 'synonym_map') {
                        # skip
                    } else {
                        $result[$key] = $items
                    }
                } else {
                    $inList = $true
                    $listKey = $key
                    $currentSection = $key
                }
            } elseif ($value -match '^-') {
                $inList = $true
                $listKey = $key
                $currentSection = $key
                $itemValue = $value.TrimStart('-').Trim()
                if ($itemValue) {
                    $currentItem = @{ $key = $itemValue }
                } else {
                    $currentItem = @{}
                }
            } elseif ($value -eq '' -and $listKeys -contains $key) {
                # Empty value for a known list key = start of multi-line list
                $inList = $true
                $listKey = $key
                $currentSection = $key
                $currentItem = @{}
            } else {
                $result[$key] = $value.Trim('"', "'")
                if ($key -eq 'schema_version') { $result.schema_version = $result[$key] }
                $currentSection = $key
            }
            continue
        }
        
        if ($line -match '^\s*-\s+(.+)$' -and $inList) {
            $itemValue = $matches[1].Trim()
            if ($itemValue -match '^([a-z_]+):\s*(.*)$') {
                $k = $matches[1]
                $v = $matches[2].Trim().Trim('"', "'")
                if ($v -eq '[') {
                    $nestDepth = 1
                    $nestKey = $k
                    $currentItem[$k] = @()
                } elseif ($v -match '^\d+$') {
                    $currentItem[$k] = [int]$v
                } else {
                    $currentItem[$k] = $v
                }
            } else {
                $currentItem[$currentSection] = $itemValue
            }
            continue
        }
        
        if ($line -match '^\s+-\s+([a-z_]+):\s*(.*)$' -and $nestDepth -gt 0) {
            $k = $matches[1]
            $v = $matches[2].Trim().Trim('"', "'")
            if ($currentItem.ContainsKey($nestKey)) {
                $currentItem[$nestKey] += @{ $k = $v }
            }
            continue
        }
        
        if ($line -match '^\s+([a-z_]+):\s*(.*)$' -and $inList) {
            $k = $matches[1]
            $v = $matches[2].Trim()
            
            if ($v -eq '[') {
                $nestDepth = 1
                $nestKey = $k
                $currentItem[$k] = @()
            } elseif ($v -match '^\[(.+)\]$') {
                $items = $matches[1] -split ',\s*' | ForEach-Object { $_.Trim().Trim('"', "'") }
                $currentItem[$k] = $items
                $nestDepth = 0
                $nestKey = ''
            } elseif ($v -match '^-') {
                $currentItem[$k] = $v.TrimStart('-').Trim().Trim('"', "'")
            } else {
                $currentItem[$k] = $v.Trim('"', "'")
            }
            continue
        }
        
        if ($line -match '^\s+-\s+([a-z_]+):\s*\[(.+)\]$' -and $inList) {
            $k = $matches[1]
            $items = $matches[2] -split ',\s*' | ForEach-Object { $_.Trim().Trim('"', "'") }
            if ($currentItem.ContainsKey($k)) {
                if ($currentItem[$k] -isnot [System.Collections.IList]) {
                    $currentItem[$k] = @($currentItem[$k])
                }
                $currentItem[$k] += $items
            } else {
                $currentItem[$k] = $items
            }
            continue
        }
    }
    
    if ($currentSection -and $inList -and $currentItem.Count -gt 0) {
        if ($listKey -eq 'pool') { $result.pool += $currentItem }
        elseif ($listKey -eq 'entries') { $result.entries += $currentItem }
    }
    
    return $result
}

function Write-Manifest {
    param(
        [string]$Path,
        [hashtable]$Manifest
    )
    
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("schema_version: `"$($Manifest.schema_version)`"")
    [void]$sb.AppendLine('pool:')
    
    foreach ($member in $Manifest.pool) {
        [void]$sb.AppendLine("  - id: `"$($member.id)`"")
        [void]$sb.AppendLine("    type: `"$($member.type)`"")
        [void]$sb.AppendLine("    handle: `"$($member.handle)`"")
        if ($member.repo) { [void]$sb.AppendLine("    repo: `"$($member.repo)`"") }
        [void]$sb.AppendLine("    languages: [$(($member.languages -join ', '))]")
        [void]$sb.AppendLine("    domains: [$(($member.domains -join ', '))]")
        [void]$sb.AppendLine("    trust_level: `"$($member.trust_level)`"")
        [void]$sb.AppendLine("    added_at: `"$($member.added_at)`"")
        [void]$sb.AppendLine("    why: `"$($member.why)`"")
    }
    
    [void]$sb.AppendLine('entries:')
    
    foreach ($entry in $Manifest.entries) {
        [void]$sb.AppendLine("  - id: `"$($entry.id)`"")
        [void]$sb.AppendLine("    pool_id: `"$($entry.pool_id)`"")
        [void]$sb.AppendLine("    repo: `"$($entry.repo)`"")
        [void]$sb.AppendLine("    file_path: `"$($entry.file_path)`"")
        [void]$sb.AppendLine("    commit: `"$($entry.commit)`"")
        [void]$sb.AppendLine("    source_url: `"$($entry.source_url)`"")
        [void]$sb.AppendLine("    added_at: `"$($entry.added_at)`"")
        [void]$sb.AppendLine("    why: `"$($entry.why)`"")
        [void]$sb.AppendLine("    primary_tags: [$(($entry.primary_tags -join ', '))]")
        [void]$sb.AppendLine("    secondary_tags: [$(($entry.secondary_tags -join ', '))]")
        
        if ($entry.synonym_map -and $entry.synonym_map.Count -gt 0) {
            [void]$sb.AppendLine('    synonym_map:')
            foreach ($synKey in $entry.synonym_map.Keys) {
                $syns = $entry.synonym_map[$synKey]
                if ($syns -is [string]) { $syns = @($syns) }
                [void]$sb.AppendLine("      $synKey : [$(($syns -join ', '))]")
            }
        }
    }
    
    $sb.ToString() | Set-Content -LiteralPath $Path -Encoding UTF8 -NoNewline
}

# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════

Test-PoolInitialized

$manifest = Read-Manifest -Path $script:MANIFEST_PATH
if ($manifest.schema_version -ne '1.0') {
    throw "Unsupported manifest schema_version: $($manifest.schema_version). Expected 1.0."
}

$cutoff = (Get-Date).AddDays(-$script:TTL_DAYS)
$toRefresh = $manifest.entries | Where-Object {
    $added = [DateTime]::Parse($_.added_at)
    return $added -lt $cutoff
}

if ($toRefresh.Count -eq 0) {
    Write-Host "reference-pool: no entries older than $($script:TTL_DAYS) days" -ForegroundColor Green
    exit 0
}

Write-Host "reference-pool: $($toRefresh.Count) entries to refresh" -ForegroundColor Cyan

$headers = @{}
$ghToken = $env:GITHUB_TOKEN
if ($ghToken) {
    $headers['Authorization'] = "token $ghToken"
    $headers['User-Agent'] = 'reference-pool'
}

$refreshed = 0
$failed = 0

foreach ($entry in $toRefresh) {
    $parsed = Parse-GitHubUrl -Url $entry.source_url
    
    Write-Host "  refreshing $($entry.id)..." -NoNewline
    
    if ($DryRun) {
        Write-Host " [DRY] would re-fetch commit $($parsed.Owner)/$($parsed.Repo)@$($parsed.Branch)" -ForegroundColor Yellow
        $refreshed++
        continue
    }
    
    $newCommit = Get-CurrentCommit -Owner $parsed.Owner -Repo $parsed.Repo -Branch $parsed.Branch -Path $parsed.Path
    
    if (-not $newCommit) {
        Write-Host " SKIP (could not resolve commit)" -ForegroundColor DarkYellow
        $failed++
        continue
    }
    
    if ($newCommit -eq $entry.commit) {
        Write-Host " SKIP (already at $newCommit)" -ForegroundColor DarkGray
        continue
    }
    
    try {
        $newContent = Invoke-WebRequest -Uri $parsed.RawUrl -UseBasicParsing -ErrorAction Stop | Select-Object -ExpandProperty Content
    } catch {
        Write-Host " FAIL (fetch error)" -ForegroundColor Red
        $failed++
        continue
    }
    
    # Update cached file
    $langDir = Join-Path $script:POOL_ROOT $entry.language
    $authorRepo = $entry.repo -replace '/', '-'
    $targetDir = Join-Path $langDir $authorRepo
    $sanitized = $entry.file_path -replace '^[\\/]+', '' -replace '/', '\'
    $targetPath = Join-Path $targetDir $sanitized
    
    $targetFileDir = Split-Path -Parent $targetPath
    if (-not (Test-Path -LiteralPath $targetFileDir -PathType Container)) {
        New-Item -ItemType Directory -Path $targetFileDir -Force | Out-Null
    }
    
    $newContent | Set-Content -LiteralPath $targetPath -Encoding UTF8 -NoNewline
    
    # Update manifest entry
    $entry.commit = $newCommit
    $entry.added_at = (Get-Date -Format 'yyyy-MM-dd')
    
    Write-Host " OK ($newCommit)" -ForegroundColor Green
    $refreshed++
    
    # Small delay to avoid rate limits
    Start-Sleep -Milliseconds 500
}

Write-Manifest -Path $script:MANIFEST_PATH -Manifest $manifest

Write-Host ""
Write-Host "reference-pool: refreshed $refreshed entries, $failed failed" -ForegroundColor Cyan
