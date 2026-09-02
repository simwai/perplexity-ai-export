<#
.SYNOPSIS
    Session file lock implementation for the Baba prompt system.
.DESCRIPTION
    Implements per-file and dependency locks per 07-protocols.md ## Session file locks.
    Provides atomic acquisition, TTL-based stale detection, wait/override-steal prompts,
    and commit/push gate integration.
.NOTES
    Loaded for PATCH and DIRECT phases only. Inert on READ_ONLY hosts.
#>

$ErrorActionPreference = 'Stop'

# ═══════════════════════════════════════════════════════════════════════════
# Named constants (single source of truth per protocol)
# ═══════════════════════════════════════════════════════════════════════════

$script:SESSION_LOCK_TTL_MINUTES = 30
$script:SESSION_LOCK_WAIT_ATTEMPTS = 3
$script:SESSION_LOCK_WAIT_INTERVAL_SECONDS = 60

# ═══════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════

function Get-RepoRoot {
    $root = & git rev-parse --show-toplevel 2>$null
    if (-not $root) { throw "Not in a git repository" }
    return $root
}

function Get-SessionId {
    # Session ID from SESSION_STATE-*.md filename or env
    if ($env:SESSION_ID) { return $env:SESSION_ID }
    $stateFiles = Get-ChildItem -Path (Get-RepoRoot) -Filter 'SESSION_STATE-*.md' -ErrorAction SilentlyContinue
    if ($stateFiles) {
        $latest = $stateFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest.BaseName -match 'SESSION_STATE-(.+)') { return $Matches[1] }
    }
    # Fallback: generate a session id
    return "session-$(Get-Date -Format 'yyyyMMddTHHmmss')-$(Get-Random -Maximum 1000000)"
}

function Get-LockDir {
    param([string]$RepoRoot)
    return Join-Path $RepoRoot '.session-locks'
}

function Get-FlatName {
    param([string]$RepoRelativePath)
    # Replace path separators with --
    return $RepoRelativePath -replace '[\\/]', '--'
}

function Get-LockPath {
    param([string]$RepoRoot, [string]$FlatName)
    return Join-Path (Get-LockDir $RepoRoot) "$FlatName.lock"
}

function Is-ReadOnlyHost {
    # Check if we're on a confirmed READ_ONLY host
    # This is set by the agent in session state; default to false
    return $false
}

function Ensure-LockDir {
    param([string]$RepoRoot)
    $lockDir = Get-LockDir $RepoRoot
    if (-not (Test-Path $lockDir)) {
        New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
    }
}

function Write-LockFiles {
    param(
        [string]$LockPath,
        [string]$Owner,
        [string[]]$Dependencies = @()
    )
    New-Item -ItemType Directory -Path $LockPath -Force | Out-Null
    $Owner | Set-Content -Path (Join-Path $LockPath 'owner') -Encoding UTF8 -NoNewline
    (Get-Date -Format 'o') | Set-Content -Path (Join-Path $LockPath 'acquired_at') -Encoding UTF8 -NoNewline
    if ($Dependencies.Count -gt 0) {
        $Dependencies | Set-Content -Path (Join-Path $LockPath 'dependencies.txt') -Encoding UTF8
    }
}

function Read-LockInfo {
    param([string]$LockPath)
    $ownerPath = Join-Path $LockPath 'owner'
    $acquiredPath = Join-Path $LockPath 'acquired_at'
    $depsPath = Join-Path $LockPath 'dependencies.txt'
    $result = @{}
    if (Test-Path $ownerPath) { $result.Owner = Get-Content $ownerPath -Raw }
    if (Test-Path $acquiredPath) { $result.AcquiredAt = Get-Content $acquiredPath -Raw }
    if (Test-Path $depsPath) { $result.Dependencies = (Get-Content $depsPath -Raw).Split("`n") | Where-Object { $_ } }
    return $result
}

function Remove-LockDir {
    param([string]$LockPath)
    if (Test-Path $LockPath) {
        Remove-Item -LiteralPath $LockPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Is-LockLive {
    param([string]$AcquiredAt)
    try {
        $acquired = [DateTime]::Parse($AcquiredAt)
        $age = (Get-Date).ToUniversalTime() - $acquired
        return $age.TotalMinutes -lt $script:SESSION_LOCK_TTL_MINUTES
    } catch {
        return $false
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# Dependency discovery (depth 1, both directions)
# ═══════════════════════════════════════════════════════════════════════════

function Get-DependencySet {
    param(
        [string]$RepoRoot,
        [string]$TargetFile
    )
    # Returns @{ File = flatName; Importers = @(); Imports = @() }
    # Depth 1 both directions: direct importers + direct imports
    # Excludes artifact directories per 07-protocols.md ## Artifact handling

    $excludeDirs = @('node_modules', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', 'out', '.cache', '.next', '.nuxt', '.svelte-kit', '.turbo', '.mypy_cache', '.ruff_cache', '.pyrefly_cache', '.pytest_cache', 'coverage', '.coverage', 'test-results', '.pre-commit-cache')
    $excludePattern = $excludeDirs -join '|'
    $rgArgs = @(
        '--files',
        '--glob', '*.{ts,tsx,js,jsx,py,ps1,cs,java,go,rs,vue,svelte}',
        '--no-ignore',
        '--max-depth', '10'
    )
    foreach ($d in $excludeDirs) {
        $rgArgs += '--glob', "!$d/**"
    }

    $allFiles = & rg @rgArgs $RepoRoot 2>$null

    $targetFlat = Get-FlatName $TargetFile
    $result = @{
        Root = $targetFlat
        Importers = @()
        Imports = @()
    }

    # Find direct importers: files that import this file
    $escapedTarget = [regex]::Escape($TargetFile)
    $quot = "'"
    $dquot = '"'
    $importPatterns = @(
        "from\s+[$quot$dquot][^$quot$dquot]*$escapedTarget[$quot$dquot]",
        "import\s+[$quot$dquot][^$quot$dquot]*$escapedTarget[$quot$dquot]",
        "require\s*\(\s*[$quot$dquot][^$quot$dquot]*$escapedTarget[$quot$dquot]"
    )
    foreach ($pattern in $importPatterns) {
        $hits = & rg -l $pattern $allFiles 2>$null
        foreach ($hit in $hits) {
            $rel = $hit.Substring($RepoRoot.Length + 1)
            $flat = Get-FlatName $rel
            if ($flat -ne $targetFlat -and $result.Importers -notcontains $flat) {
                $result.Importers += $flat
            }
        }
    }

    # Find direct imports: files this file imports
    if (Test-Path (Join-Path $RepoRoot $TargetFile)) {
        $content = Get-Content (Join-Path $RepoRoot $TargetFile) -Raw -ErrorAction SilentlyContinue
        if ($content) {
            $quot = "'"
            $dquot = '"'
            $pattern = "(?:from|import|require)\s+[$quot$dquot]([$quot$dquot]+)[$quot$dquot]"
            $importMatches = $content | Select-String -Pattern $pattern -AllMatches
            foreach ($match in $importMatches.Matches) {
                $importPath = $match.Groups[1].Value
                # Resolve relative to target file's directory
                $targetDir = Split-Path $TargetFile
                $resolved = Resolve-RelativeImport $RepoRoot $targetDir $importPath
                if ($resolved -and $resolved -ne $targetFlat -and $result.Imports -notcontains $resolved) {
                    $result.Imports += $resolved
                }
            }
        }
    }

    return $result
}

function Resolve-RelativeImport {
    param([string]$RepoRoot, [string]$FromDir, [string]$ImportPath)
    # Skip external packages (no . or / prefix, or starts with @)
    if ($ImportPath -notmatch '^\.') { return $null }
    # Resolve relative path
    $fullPath = Join-Path $FromDir $ImportPath
    # Try with common extensions
    $extensions = @('', '.ts', '.tsx', '.js', '.jsx', '.py', '.ps1', '/index.ts', '/index.tsx', '/index.js', '/index.jsx')
    foreach ($ext in $extensions) {
        $candidate = $fullPath + $ext
        if (Test-Path (Join-Path $RepoRoot $candidate)) {
            return Get-FlatName $candidate
        }
    }
    return $null
}

# ═══════════════════════════════════════════════════════════════════════════
# Lock acquisition
# ═══════════════════════════════════════════════════════════════════════════

function Acquire-FileLock {
    param(
        [string]$RepoRelativePath,
        [string]$SessionId = (Get-SessionId),
        [switch]$Force = $false
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true; Reason = 'READ_ONLY host' } }

    $repoRoot = Get-RepoRoot
    Ensure-LockDir $repoRoot

    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    for ($attempt = 0; $attempt -le $script:SESSION_LOCK_WAIT_ATTEMPTS; $attempt++) {
        try {
            # Try to create lock directory atomically
            New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
            Write-LockFiles -LockPath $lockPath -Owner $SessionId
            return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName }
        } catch {
            if (-not (Test-Path $lockPath)) { throw }
            # Lock exists - check if live
            $info = Read-LockInfo $lockPath
            if ($info.Owner -eq $SessionId) {
                # Already owned by us - refresh timestamp
                Write-LockFiles -LockPath $lockPath -Owner $SessionId
                return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Refreshed = $true }
            }
            if (Is-LockLive $info.AcquiredAt) {
                # Live peer lock
                if ($attempt -lt $script:SESSION_LOCK_WAIT_ATTEMPTS) {
                    Write-Host "Lock held by $($info.Owner) (acquired $($info.AcquiredAt)). Waiting... (attempt $($attempt + 1)/$script:SESSION_LOCK_WAIT_ATTEMPTS)" -ForegroundColor Yellow
                    Start-Sleep -Seconds $script:SESSION_LOCK_WAIT_INTERVAL_SECONDS
                    continue
                }
                # Wait exhausted - surface to user
                return @{
                    Success = $false
                    LockPath = $lockPath
                    FlatName = $flatName
                    Blocked = $true
                    Owner = $info.Owner
                    AcquiredAt = $info.AcquiredAt
                    Live = $true
                }
            } else {
                # Stale lock
                return @{
                    Success = $false
                    LockPath = $lockPath
                    FlatName = $flatName
                    Blocked = $true
                    Owner = $info.Owner
                    AcquiredAt = $info.AcquiredAt
                    Live = $false
                    Stale = $true
                }
            }
        }
    }
}

function Acquire-DependencyLock {
    param(
        [string]$RepoRelativePath,
        [string]$SessionId = (Get-SessionId),
        [switch]$Force = $false
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true; Reason = 'READ_ONLY host' } }

    $repoRoot = Get-RepoRoot
    Ensure-LockDir $repoRoot

    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    # Discover dependency set
    $depSet = Get-DependencySet -RepoRoot $repoRoot -TargetFile $RepoRelativePath
    $allDeps = @($depSet.Root) + $depSet.Importers + $depSet.Imports

    for ($attempt = 0; $attempt -le $script:SESSION_LOCK_WAIT_ATTEMPTS; $attempt++) {
        $blocked = $false
        $blockingLock = $null

        # Check if any file in dependency set is locked by a live peer
        foreach ($dep in $allDeps) {
            $depLockPath = Get-LockPath $repoRoot $dep
            if (Test-Path $depLockPath) {
                $info = Read-LockInfo $depLockPath
                if ($info.Owner -ne $SessionId -and (Is-LockLive $info.AcquiredAt)) {
                    $blocked = $true
                    $blockingLock = @{ Path = $depLockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $dep }
                    break
                }
            }
        }

        if (-not $blocked) {
            # Try to create our lock directory
            try {
                New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
                Write-LockFiles -LockPath $lockPath -Owner $SessionId -Dependencies $allDeps
                return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Dependencies = $allDeps }
            } catch {
                if (-not (Test-Path $lockPath)) { throw }
                # Race condition - another session created it
                $info = Read-LockInfo $lockPath
                if ($info.Owner -eq $SessionId) {
                    Write-LockFiles -LockPath $lockPath -Owner $SessionId -Dependencies $allDeps
                    return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Dependencies = $allDeps; Refreshed = $true }
                }
                if (Is-LockLive $info.AcquiredAt) {
                    $blocked = $true
                    $blockingLock = @{ Path = $lockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $flatName }
                } else {
                    $blocked = $true
                    $blockingLock = @{ Path = $lockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $flatName; Stale = $true }
                }
            }
        }

        if ($blocked) {
            if ($attempt -lt $script:SESSION_LOCK_WAIT_ATTEMPTS) {
                Write-Host "Dependency lock blocked by $($blockingLock.Owner) on $($blockingLock.FlatName) (acquired $($blockingLock.AcquiredAt)). Waiting... (attempt $($attempt + 1)/$script:SESSION_LOCK_WAIT_ATTEMPTS)" -ForegroundColor Yellow
                Start-Sleep -Seconds $script:SESSION_LOCK_WAIT_INTERVAL_SECONDS
                continue
            }
            return @{
                Success = $false
                LockPath = $lockPath
                FlatName = $flatName
                Dependencies = $allDeps
                Blocked = $true
                BlockingLock = $blockingLock
            }
        }
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# Lock release
# ═══════════════════════════════════════════════════════════════════════════

function Release-FileLock {
    param(
        [string]$RepoRelativePath,
        [string]$SessionId = (Get-SessionId)
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true } }

    $repoRoot = Get-RepoRoot
    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    if (-not (Test-Path $lockPath)) {
        return @{ Success = $true; AlreadyReleased = $true }
    }

    $info = Read-LockInfo $lockPath
    if ($info.Owner -ne $SessionId) {
        throw "Cannot release lock owned by $($info.Owner) (current session: $SessionId)"
    }

    Remove-LockDir $lockPath
    return @{ Success = $true; Released = $true }
}

function Release-DependencyLock {
    param(
        [string]$RepoRelativePath,
        [string]$SessionId = (Get-SessionId)
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true } }

    $repoRoot = Get-RepoRoot
    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    if (-not (Test-Path $lockPath)) {
        return @{ Success = $true; AlreadyReleased = $true }
    }

    $info = Read-LockInfo $lockPath
    if ($info.Owner -ne $SessionId) {
        throw "Cannot release dependency lock owned by $($info.Owner) (current session: $SessionId)"
    }

    Remove-LockDir $lockPath
    return @{ Success = $true; Released = $true }
}

# ═══════════════════════════════════════════════════════════════════════════
# Commit/push gate integration
# ═══════════════════════════════════════════════════════════════════════════

function Verify-LocksForStagedFiles {
    param(
        [string[]]$StagedFiles,
        [string]$SessionId = (Get-SessionId)
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true } }

    $repoRoot = Get-RepoRoot
    $results = @()

    foreach ($file in $StagedFiles) {
        $relPath = $file
        if ($file -like "$repoRoot*") { $relPath = $file.Substring($repoRoot.Length + 1) }
        $flatName = Get-FlatName $relPath
        $lockPath = Get-LockPath $repoRoot $flatName

        if (-not (Test-Path $lockPath)) {
            $results += @{ File = $relPath; LockHeld = $false; Reason = 'No lock exists' }
            continue
        }

        $info = Read-LockInfo $lockPath
        if ($info.Owner -eq $SessionId) {
            # Also check for dependency lock covering this file
            if ($info.Dependencies -and $info.Dependencies.Count -gt 0) {
                $results += @{ File = $relPath; LockHeld = $true; Type = 'Dependency'; Owner = $SessionId }
            } else {
                $results += @{ File = $relPath; LockHeld = $true; Type = 'PerFile'; Owner = $SessionId }
            }
        } else {
            $results += @{ File = $relPath; LockHeld = $false; Owner = $info.Owner; Reason = 'Owned by another session' }
        }
    }

    $allHeld = $results | Where-Object { -not $_.LockHeld }
    return @{ Success = ($allHeld.Count -eq 0); Results = $results }
}

function ReReadAndDiffStagedFiles {
    param(
        [string[]]$StagedFiles,
        [string]$ExpectedContentMap  # Hashtable: file -> expected content
    )

    $repoRoot = Get-RepoRoot
    $results = @()

    foreach ($file in $StagedFiles) {
        $fullPath = Join-Path $repoRoot $file
        if (-not (Test-Path $fullPath)) {
            $results += @{ File = $file; Match = $false; Reason = 'File not found' }
            continue
        }

        $current = Get-Content $fullPath -Raw -Encoding UTF8
        $expected = $ExpectedContentMap[$file]
        if ($expected -eq $null) {
            $results += @{ File = $file; Match = $false; Reason = 'No expected content recorded' }
            continue
        }

        $match = ($current -eq $expected)
        $results += @{ File = $file; Match = $match; Reason = if ($match) { 'OK' } else { 'Content differs from expected' } }
    }

    $mismatches = $results | Where-Object { -not $_.Match }
    return @{ Success = ($mismatches.Count -eq 0); Results = $results }
}
