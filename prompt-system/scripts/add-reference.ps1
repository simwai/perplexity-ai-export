<#
.SYNOPSIS
    Adds a reference file to the global reference pool.
.DESCRIPTION
    Fetches a file from GitHub, pins it to a specific commit (default: current
    HEAD), saves it to the pool, and appends a manifest entry. Auto-creates pool
    members for new authors/repos. Designed for both CLI and programmatic use.
#>

param(
    [Parameter(Mandatory)][string]$Url,
    [string]$Commit,
    [Parameter(Mandatory)][string]$Language,
    [Parameter(Mandatory)][string]$Domain,
    [Parameter(Mandatory)][string]$Keywords,
    [string]$Why,
    [string]$PoolWhy,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$script:POOL_ROOT = if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.config\opencode\reference-pool'
} else {
    Join-Path $env:HOME '.config\opencode\reference-pool'
}

$script:MANIFEST_PATH = Join-Path $script:POOL_ROOT 'manifest.yaml'

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
    
    # Supports:
    # https://github.com/owner/repo/blob/branch/path/to/file
    # https://raw.githubusercontent.com/owner/repo/branch/path/to/file
    
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
    
    throw "Unsupported GitHub URL format: $Url. Expected github.com/blob/... or raw.githubusercontent.com/..."
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
        # If API fails (rate limit, unauthenticated), fall back to empty commit
        # and let the caller know via the result object.
    }
    return $null
}

function Get-PoolMember {
    param(
        [string]$Owner,
        [string]$Repo,
        [hashtable]$Manifest
    )
    
    foreach ($member in $Manifest.pool) {
        $isAuthor = ($member.type -eq 'author' -and $member.handle -eq $Owner)
        $isRepo = ($member.type -eq 'repo' -and $member.repo -eq "$Owner/$Repo")
        if ($isAuthor -or $isRepo) {
            return $member
        }
    }
    return $null
}

function New-PoolMember {
    param(
        [string]$Id,
        [string]$Type,
        [string]$Handle,
        [string]$Repo,
        [string[]]$Languages,
        [string[]]$Domains,
        [string]$TrustLevel,
        [string]$Why
    )
    
    return [ordered]@{
        id = $Id
        type = $Type
        handle = $Handle
        repo = $Repo
        languages = $Languages
        domains = $Domains
        trust_level = $TrustLevel
        added_at = (Get-Date -Format 'yyyy-MM-dd')
        why = $Why
    }
}

function New-Entry {
    param(
        [string]$Id,
        [string]$PoolId,
        [string]$Repo,
        [string]$FilePath,
        [string]$Commit,
        [string]$SourceUrl,
        [string]$AddedAt,
        [string]$Why,
        [string[]]$PrimaryTags,
        [string[]]$SecondaryTags,
        [hashtable]$SynonymMap
    )
    
    $entry = [ordered]@{
        id = $Id
        pool_id = $PoolId
        repo = $Repo
        file_path = $FilePath
        commit = $Commit
        source_url = $SourceUrl
        added_at = $AddedAt
        why = $Why
        primary_tags = $PrimaryTags
        secondary_tags = $SecondaryTags
    }
    
    if ($SynonymMap -and $SynonymMap.Count -gt 0) {
        $entry['synonym_map'] = $SynonymMap
    }
    
    return $entry
}

function Save-FileToPool {
    param(
        [string]$Language,
        [string]$AuthorRepo,
        [string]$FilePath,
        [string]$Content
    )
    
    $langDir = Join-Path $script:POOL_ROOT $Language
    if (-not (Test-Path -LiteralPath $langDir -PathType Container)) {
        New-Item -ItemType Directory -Path $langDir -Force | Out-Null
    }
    
    $targetDir = Join-Path $langDir $AuthorRepo
    if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    
    # Sanitize file path: remove leading slashes, normalize separators
    $sanitized = $FilePath -replace '^[\\/]+', '' -replace '/', '\'
    $targetPath = Join-Path $targetDir $sanitized
    
    $targetFileDir = Split-Path -Parent $targetPath
    if (-not (Test-Path -LiteralPath $targetFileDir -PathType Container)) {
        New-Item -ItemType Directory -Path $targetFileDir -Force | Out-Null
    }
    
    $Content | Set-Content -LiteralPath $targetPath -Encoding UTF8 -NoNewline
    return $targetPath
}

function Read-Manifest {
    param([string]$Path)
    
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if (-not $content) { return @{ schema_version = ''; pool = @(); entries = @() } }
    
    # Minimal YAML parser for our specific schema
    $lines = $content -split "`n"
    $result = @{ schema_version = ''; pool = @(); entries = @() }
    $currentSection = ''
    $inList = $false
    $listItems = @()
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
                        # skip inline synonym_map; handled below in block mode
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

function Find-DuplicateEntry {
    param(
        [hashtable]$Manifest,
        [string]$Repo,
        [string]$FilePath,
        [string]$Commit
    )
    
    foreach ($entry in $Manifest.entries) {
        if ($entry.repo -eq $Repo -and $entry.file_path -eq $FilePath) {
            return $entry
        }
    }
    return $null
}

function New-EntryId {
    param([string]$PoolId, [string]$FilePath)
    
    $sanitized = $PoolId -replace '[^a-z0-9-]', '-'
    $fileSanitized = ($FilePath -replace '[^a-z0-9-]', '-' -replace '-+', '-').Trim('-')
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    return "$sanitized-$fileSanitized-$timestamp"
}

# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════

Test-PoolInitialized

$parsedUrl = Parse-GitHubUrl -Url $Url

# Determine commit
$commit = $Commit
if (-not $commit) {
    $commit = Get-CurrentCommit -Owner $parsedUrl.Owner -Repo $parsedUrl.Repo -Branch $parsedUrl.Branch -Path $parsedUrl.Path
    if (-not $commit) {
        Write-Warning "Could not resolve commit SHA for $Url. Using 'unknown' as fallback."
        $commit = 'unknown'
    }
}

# Fetch file content
try {
    $fileContent = Invoke-WebRequest -Uri $parsedUrl.RawUrl -UseBasicParsing -ErrorAction Stop | Select-Object -ExpandProperty Content
} catch {
    throw "Failed to fetch $($parsedUrl.RawUrl): $_"
}

# Read manifest
$manifest = Read-Manifest -Path $script:MANIFEST_PATH
if ($manifest.schema_version -ne '1.0') {
    throw "Unsupported manifest schema_version: $($manifest.schema_version). Expected 1.0."
}

# Determine or create pool member
$existingMember = Get-PoolMember -Owner $parsedUrl.Owner -Repo $parsedUrl.Repo -Manifest $manifest
$poolId = $null
$poolMemberCreated = $false

if ($existingMember) {
    $poolId = $existingMember.id
} else {
    $poolId = "$($parsedUrl.Owner)-$($parsedUrl.Repo)"
    $poolId = $poolId.ToLower().Replace('/', '-').Replace('.', '-')
    
    $memberWhy = $PoolWhy
    if (-not $memberWhy) {
        $memberWhy = "Auto-created from $Url"
    }
    
    $newMember = New-PoolMember `
        -Id $poolId `
        -Type 'repo' `
        -Handle $parsedUrl.Owner `
        -Repo "$($parsedUrl.Owner)/$($parsedUrl.Repo)" `
        -Languages @($Language) `
        -Domains @($Domain) `
        -TrustLevel 'premium' `
        -Why $memberWhy
    
    $manifest.pool += $newMember
    $poolMemberCreated = $true
}

# Check for duplicate entry (same repo + file_path)
$duplicate = Find-DuplicateEntry -Manifest $manifest -Repo "$($parsedUrl.Owner)/$($parsedUrl.Repo)" -FilePath $parsedUrl.Path -Commit $commit
$entryId = New-EntryId -PoolId $poolId -FilePath $parsedUrl.Path
$authorRepo = "$($parsedUrl.Owner)-$($parsedUrl.Repo)"

if ($duplicate) {
    if ($duplicate.commit -eq $commit) {
        # Same file, same commit: refuse
        throw "Entry already exists: $($duplicate.id) (repo=$($duplicate.repo), file=$($duplicate.file_path), commit=$commit)"
    }
    
    # Same file, different commit: override with newer version
    $duplicate.commit = $commit
    $duplicate.added_at = (Get-Date -Format 'yyyy-MM-dd')
    $duplicate.why = $Why
    $duplicate.primary_tags = ($Keywords -split ',').Trim()
    $duplicate.secondary_tags = @()
    
    # Update cached file
    Save-FileToPool -Language $Language -AuthorRepo $authorRepo -FilePath $parsedUrl.Path -Content $fileContent
    
    if ($DryRun) {
        Write-Host "[DRY] Would update entry $($duplicate.id) with commit $commit" -ForegroundColor Yellow
        return
    }
    
    Write-Manifest -Path $script:MANIFEST_PATH -Manifest $manifest
    Write-Host "reference-pool: updated entry $($duplicate.id) to commit $commit" -ForegroundColor Green
    return
}

# New entry
$tags = ($Keywords -split ',').Trim()
$primaryTags = $tags
$secondaryTags = @()

$synonymMap = @{}
$entry = New-Entry `
    -Id $entryId `
    -PoolId $poolId `
    -Repo "$($parsedUrl.Owner)/$($parsedUrl.Repo)" `
    -FilePath $parsedUrl.Path `
    -Commit $commit `
    -SourceUrl $Url `
    -AddedAt (Get-Date -Format 'yyyy-MM-dd') `
    -Why $Why `
    -PrimaryTags $primaryTags `
    -SecondaryTags $secondaryTags `
    -SynonymMap $synonymMap

$manifest.entries += $entry

# Save cached file
$poolPath = Save-FileToPool -Language $Language -AuthorRepo $authorRepo -FilePath $parsedUrl.Path -Content $fileContent

if ($DryRun) {
    Write-Host "[DRY] Would add entry $entryId" -ForegroundColor Yellow
    Write-Host "  Pool: $poolId" -ForegroundColor Gray
    Write-Host "  File: $poolPath" -ForegroundColor Gray
    Write-Host "  Commit: $commit" -ForegroundColor Gray
    return
}

Write-Manifest -Path $script:MANIFEST_PATH -Manifest $manifest
Write-Host "reference-pool: added $entryId" -ForegroundColor Green
Write-Host "  Pool: $poolId $(if ($poolMemberCreated) {'(new)'} else {'(existing)'})" -ForegroundColor Gray
Write-Host "  File: $poolPath" -ForegroundColor Gray
Write-Host "  Commit: $commit" -ForegroundColor Gray
