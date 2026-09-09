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
# NOTE: the active multi-minute blocking wait was removed in favor of
# attempt-once-then-surface. The WAIT_* values are retained for protocol
# compatibility and hosted runners that implement their own wait.

# Resolved-once session identity cache. Get-SessionId populates this on first
# call so Acquire, Verify, and Release agree on the owner for the session.
$script:CachedSessionId = $null

# ═══════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════

function Get-RepoRoot {
    $root = & git rev-parse --show-toplevel 2>$null
    if (-not $root) { throw "Not in a git repository" }
    return $root
}

function Get-SessionId {
    # Session ID from SESSION_ID env, else latest SESSION_STATE-*.md filename.
    # Resolved once and cached: a per-call generated fallback would disagree
    # across Acquire/Verify/Release and misattribute lock ownership.
    if ($script:CachedSessionId) { return $script:CachedSessionId }
    if ($env:SESSION_ID) { $script:CachedSessionId = $env:SESSION_ID; return $script:CachedSessionId }
    $stateFiles = Get-ChildItem -Path (Get-RepoRoot) -Filter 'SESSION_STATE-*.md' -ErrorAction SilentlyContinue
    if ($stateFiles) {
        $latest = $stateFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest.BaseName -match 'SESSION_STATE-(.+)') { $script:CachedSessionId = $Matches[1]; return $script:CachedSessionId }
    }
    # Fallback: generate once per process and reuse for the rest of the session.
    $script:CachedSessionId = "session-$(Get-Date -Format 'yyyyMMddTHHmmss')-$(Get-Random -Maximum 1000000)"
    return $script:CachedSessionId
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
    # Host capability comes from the BABA_READ_ONLY flag, set by the agent from
    # its session carrier. The lock protocol is inert on READ_ONLY hosts: every
    # entry point below returns Skipped instead of touching the filesystem.
    if ($env:BABA_READ_ONLY -in @('1', 'true', 'yes')) { return $true }
    return $false
}

function Ensure-LockDir {
    param([string]$RepoRoot)
    $lockDir = Get-LockDir $RepoRoot
    if (-not (Test-Path $lockDir)) {
        New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
    }
}

function New-LockDirectoryAtomic {
    param([string]$LockPath)
    # Atomic create-or-fail: success means this session won the race, and an
    # IOException means the lock already exists (already locked). Never -Force:
    # overwriting here would silently steal a peer's lock.
    New-Item -ItemType Directory -Path $LockPath -ErrorAction Stop | Out-Null
}

function Test-CoveringDependencyLock {
    param(
        [string]$RepoRoot,
        [string]$FlatName,
        [string]$SessionId
    )
    # Return a live peer dependency lock covering FlatName, else $null.
    # Self-owned covering locks are excluded: they never block this session.
    $lockDir = Get-LockDir $RepoRoot
    if (-not (Test-Path -LiteralPath $lockDir)) { return $null }
    foreach ($dir in Get-ChildItem -Path $lockDir -Directory -Filter '*.lock' -ErrorAction SilentlyContinue) {
        $depsPath = Join-Path $dir.FullName 'dependencies.txt'
        if (-not (Test-Path -LiteralPath $depsPath)) { continue }
        $covers = @(Get-Content $depsPath -ErrorAction SilentlyContinue) | Where-Object { $_ -and $_.Trim() -eq $FlatName }
        if (-not $covers) { continue }
        $info = Read-LockInfo $dir.FullName
        if ($info.Owner -and ($info.Owner.Trim() -ne $SessionId) -and (Is-LockLive $info.AcquiredAt)) {
            return @{ Path = $dir.FullName; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = ($dir.BaseName -replace '\.lock$', '') }
        }
    }
    return $null
}

function Write-LockFiles {
    param(
        [string]$LockPath,
        [string]$Owner,
        [string[]]$Dependencies = @()
    )
    # The lock directory must already exist via New-LockDirectoryAtomic. This
    # guard only heals a missing directory; it never overwrites an existing one.
    if (-not (Test-Path -LiteralPath $LockPath)) {
        New-LockDirectoryAtomic -LockPath $LockPath
    }
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
    # Returns @{ Root = flatName; Importers = @(); Imports = @() }
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

    if (-not $allFiles) { return $result }

    # Find direct importers: files whose import strings reference this file.
    # Full repo-relative paths rarely appear in import strings (imports are
    # relative like ./sibling), so match the leaf filename as well. Same-leaf
    # collisions across directories are accepted noise for a depth-1 heuristic;
    # the lock decision itself stays user-owned.
    $targetLeaf = Split-Path -Leaf $TargetFile
    $escapedLeaf = [regex]::Escape($targetLeaf)
    $escapedTarget = [regex]::Escape($TargetFile)
    # NOTE: patterns use \x22 instead of a literal double-quote character. A
    # raw " in the argument breaks Windows PowerShell 5.1 native argument
    # passing to rg, and the call dies with a regex parse error.
    $q = "'"
    $importPatterns = @(
        "from\s+[$q\x22][^$q\x22]*$escapedTarget[$q\x22]",
        "import\s+[$q\x22][^$q\x22]*$escapedTarget[$q\x22]",
        "require\s*\(\s*[$q\x22][^$q\x22]*$escapedTarget[$q\x22]",
        "from\s+[$q\x22][^$q\x22]*$escapedLeaf[$q\x22]",
        "import\s+[$q\x22][^$q\x22]*$escapedLeaf[$q\x22]",
        "require\s*\(\s*[$q\x22][^$q\x22]*$escapedLeaf[$q\x22]"
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
            $q = "'"
            $pattern = "(?:from|import|require)\s+[$q\x22]([^$q\x22]+)[$q\x22]"
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
    # Repo-root-level files have no directory part; resolve from '.'.
    if (-not $FromDir) { $FromDir = '.' }
    # Resolve relative path and normalize (Join-Path alone leaves './' and
    # '../' segments in place, which would corrupt the flat name).
    $rootFull = $RepoRoot.TrimEnd('\', '/')
    # Try with common extensions
    $extensions = @('', '.ts', '.tsx', '.js', '.jsx', '.py', '.ps1', '/index.ts', '/index.tsx', '/index.js', '/index.jsx')
    foreach ($ext in $extensions) {
        $fullPath = [IO.Path]::GetFullPath((Join-Path (Join-Path $rootFull $FromDir) ($ImportPath + $ext)))
        if (Test-Path -LiteralPath $fullPath) {
            return Get-FlatName $fullPath.Substring($rootFull.Length + 1)
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
        # Retained for signature stability. Steal decisions are user-driven at
        # the agent layer; this function never auto-steals, flag or not.
        [switch]$Force = $false
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true; Reason = 'READ_ONLY host' } }

    $repoRoot = Get-RepoRoot
    Ensure-LockDir $repoRoot

    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    # A live peer dependency lock covering this file blocks per-file acquisition.
    $covering = Test-CoveringDependencyLock -RepoRoot $repoRoot -FlatName $flatName -SessionId $SessionId
    if ($covering) {
        return @{
            Success = $false
            LockPath = $lockPath
            FlatName = $flatName
            Blocked = $true
            CoveringDependency = $covering
            Owner = $covering.Owner
            AcquiredAt = $covering.AcquiredAt
            Live = $true
            Decision = @('Wait longer', 'Skip this file', 'Override-steal the lock')
        }
    }

    # Single attempt, then surface. A blocking multi-minute wait outlasts a
    # model turn, so a contended lock returns immediately with the user-owned
    # decision set instead of sleeping inside the turn.
    try {
        New-LockDirectoryAtomic -LockPath $lockPath
        Write-LockFiles -LockPath $lockPath -Owner $SessionId
        return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName }
    } catch {
        if (-not (Test-Path $lockPath)) { throw }
        # Lock exists - check if live
        $info = Read-LockInfo $lockPath
        if ($info.Owner -and ($info.Owner.Trim() -eq $SessionId)) {
            # Self-owned: re-confirmed above, safe to refresh the timestamp.
            Write-LockFiles -LockPath $lockPath -Owner $SessionId
            return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Refreshed = $true }
        }
        $stale = -not (Is-LockLive $info.AcquiredAt)
        $decision = @('Wait longer', 'Skip this file', 'Override-steal the lock')
        if ($stale) { $decision += 'Contact the peer' }
        return @{
            Success = $false
            LockPath = $lockPath
            FlatName = $flatName
            Blocked = $true
            Owner = $info.Owner
            AcquiredAt = $info.AcquiredAt
            Live = (-not $stale)
            Stale = $stale
            Decision = $decision
        }
    }
}

function Acquire-DependencyLock {
    param(
        [string]$RepoRelativePath,
        [string]$SessionId = (Get-SessionId),
        # Retained for signature stability. Steal decisions are user-driven at
        # the agent layer; this function never auto-steals, flag or not.
        [switch]$Force = $false
    )

    if (Is-ReadOnlyHost) { return @{ Success = $true; Skipped = $true; Reason = 'READ_ONLY host' } }

    $repoRoot = Get-RepoRoot
    Ensure-LockDir $repoRoot

    $flatName = Get-FlatName $RepoRelativePath
    $lockPath = Get-LockPath $repoRoot $flatName

    # Discover dependency set
    $depSet = Get-DependencySet -RepoRoot $RepoRoot -TargetFile $RepoRelativePath
    $allDeps = @($depSet.Root) + $depSet.Importers + $depSet.Imports

    # Single attempt, then surface (no blocking wait; see Acquire-FileLock).
    $blockingLock = $null
    foreach ($dep in $allDeps) {
        $depLockPath = Get-LockPath $repoRoot $dep
        if (Test-Path $depLockPath) {
            $info = Read-LockInfo $depLockPath
            if ($info.Owner -and ($info.Owner.Trim() -ne $SessionId) -and (Is-LockLive $info.AcquiredAt)) {
                $blockingLock = @{ Path = $depLockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $dep }
                break
            }
            if (-not (Is-LockLive $info.AcquiredAt)) {
                $blockingLock = @{ Path = $depLockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $dep; Stale = $true }
                break
            }
        }
        # A live peer dependency lock covering this member blocks as well.
        $cover = Test-CoveringDependencyLock -RepoRoot $repoRoot -FlatName $dep -SessionId $SessionId
        if ($cover) {
            $blockingLock = @{ Path = $cover.Path; Owner = $cover.Owner; AcquiredAt = $cover.AcquiredAt; FlatName = $cover.FlatName; CoveringDependency = $true }
            break
        }
    }

    if ($blockingLock) {
        $decision = @('Wait longer', 'Skip this file', 'Override-steal the lock')
        if ($blockingLock.Stale) { $decision += 'Contact the peer' }
        return @{
            Success = $false
            LockPath = $lockPath
            FlatName = $flatName
            Dependencies = $allDeps
            Blocked = $true
            BlockingLock = $blockingLock
            Decision = $decision
        }
    }

    try {
        New-LockDirectoryAtomic -LockPath $lockPath
        Write-LockFiles -LockPath $lockPath -Owner $SessionId -Dependencies $allDeps
        return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Dependencies = $allDeps }
    } catch {
        if (-not (Test-Path $lockPath)) { throw }
        # Race condition - another session created it
        $info = Read-LockInfo $lockPath
        if ($info.Owner -and ($info.Owner.Trim() -eq $SessionId)) {
            # Self-owned: re-confirmed above, safe to refresh with the new set.
            Write-LockFiles -LockPath $lockPath -Owner $SessionId -Dependencies $allDeps
            return @{ Success = $true; LockPath = $lockPath; FlatName = $flatName; Dependencies = $allDeps; Refreshed = $true }
        }
        $stale = -not (Is-LockLive $info.AcquiredAt)
        $decision = @('Wait longer', 'Skip this file', 'Override-steal the lock')
        if ($stale) { $decision += 'Contact the peer' }
        return @{
            Success = $false
            LockPath = $lockPath
            FlatName = $flatName
            Dependencies = $allDeps
            Blocked = $true
            BlockingLock = @{ Path = $lockPath; Owner = $info.Owner; AcquiredAt = $info.AcquiredAt; FlatName = $flatName; Stale = $stale }
            Decision = $decision
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

        if (Test-Path $lockPath) {
            $info = Read-LockInfo $lockPath
            if ($info.Owner -and ($info.Owner.Trim() -eq $SessionId)) {
                # Also check for dependency lock covering this file
                if ($info.Dependencies -and $info.Dependencies.Count -gt 0) {
                    $results += @{ File = $relPath; LockHeld = $true; Type = 'Dependency'; Owner = $SessionId }
                } else {
                    $results += @{ File = $relPath; LockHeld = $true; Type = 'PerFile'; Owner = $SessionId }
                }
                continue
            }
            $results += @{ File = $relPath; LockHeld = $false; Owner = $info.Owner; Reason = 'Owned by another session' }
            continue
        }

        # No exact lock: scan every lock for a live dependency lock covering
        # this file. Self-owned coverage counts as held; live peer coverage
        # refuses staging.
        $covered = $false
        $lockDir = Get-LockDir $repoRoot
        if (Test-Path -LiteralPath $lockDir) {
            foreach ($dir in Get-ChildItem -Path $lockDir -Directory -Filter '*.lock' -ErrorAction SilentlyContinue) {
                $depsPath = Join-Path $dir.FullName 'dependencies.txt'
                if (-not (Test-Path -LiteralPath $depsPath)) { continue }
                $covers = @(Get-Content $depsPath -ErrorAction SilentlyContinue) | Where-Object { $_ -and $_.Trim() -eq $flatName }
                if (-not $covers) { continue }
                $coverInfo = Read-LockInfo $dir.FullName
                if ($coverInfo.Owner -and (Is-LockLive $coverInfo.AcquiredAt)) {
                    if ($coverInfo.Owner.Trim() -eq $SessionId) {
                        $results += @{ File = $relPath; LockHeld = $true; Type = 'Dependency'; Owner = $SessionId }
                    } else {
                        $results += @{ File = $relPath; LockHeld = $false; Owner = $coverInfo.Owner; Reason = 'Covered by a live peer dependency lock' }
                    }
                    $covered = $true
                    break
                }
            }
        }
        if ($covered) { continue }

        $results += @{ File = $relPath; LockHeld = $false; Reason = 'No lock exists' }
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
