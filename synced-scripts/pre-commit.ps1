<#
.SYNOPSIS
    Self-contained pre-commit hook for the Baba prompt system.
.DESCRIPTION
    Runs generate-adapters.ps1 and other checks directly without external framework.
    Place this script at .git/hooks/pre-commit (or call it from there).
#>

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host "Running pre-commit checks..." -ForegroundColor Cyan

# 1. Generate adapters (must run first so generated files are present for other checks)
Write-Host "`n[1/5] Generating platform adapters..." -ForegroundColor Yellow
& "$repoRoot\generate-adapters.ps1"
if (-not $?) {
    Write-Error "generate-adapters.ps1 failed"
    exit 1
}
Write-Host "  OK" -ForegroundColor Green

# 2. File hygiene checks (trailing whitespace, EOF newline, LF line endings, merge conflicts)
# Define paths to exclude from checks
$excludePaths = @('\.git\\', '\\node_modules\\', '\.opencode\\node_modules\\')

function Should-Exclude {
    param([string]$Path)
    foreach ($pattern in $excludePaths) {
        if ($Path -match $pattern) { return $true }
    }
    return $false
}

Write-Host "`n[2/5] Checking file hygiene..." -ForegroundColor Yellow

# Check for trailing whitespace
$filesWithTrailingWs = Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { -not (Should-Exclude $_.FullName) } |
    Where-Object { $_.Extension -in '.md', '.yaml', '.yml', '.json', '.toml', '.ps1', '.psd1', '.psm1', '.txt' } |
    Where-Object { Get-Content -LiteralPath $_.FullName -Raw | Select-String -Pattern '\s+$' } |
    Select-Object -ExpandProperty FullName

if ($filesWithTrailingWs) {
    Write-Warning "Files with trailing whitespace:"
    $filesWithTrailingWs | ForEach-Object { Write-Warning "  $_" }
    # Auto-fix
    $filesWithTrailingWs | ForEach-Object {
        (Get-Content -LiteralPath $_ -Raw) -replace '\s+$', '' | Set-Content -LiteralPath $_ -NoNewline
    }
    Write-Host "  Fixed trailing whitespace" -ForegroundColor Green
} else {
    Write-Host "  No trailing whitespace" -ForegroundColor Green
}

# Check for missing EOF newline
$filesMissingEofNl = Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { -not (Should-Exclude $_.FullName) } |
    Where-Object { $_.Extension -in '.md', '.yaml', '.yml', '.json', '.toml', '.ps1', '.psd1', '.psm1', '.txt' } |
    Where-Object {
        $lines = Get-Content -LiteralPath $_.FullName
        if (-not $lines) { return $false }
        return $lines[-1] -ne ''
    } |
    Select-Object -ExpandProperty FullName

if ($filesMissingEofNl) {
    Write-Warning "Files missing EOF newline:"
    $filesMissingEofNl | ForEach-Object { Write-Warning "  $_" }
    # Auto-fix
    $filesMissingEofNl | ForEach-Object { Add-Content -LiteralPath $_ -Value '' }
    Write-Host "  Fixed missing EOF newlines" -ForegroundColor Green
} else {
    Write-Host "  All files have EOF newline" -ForegroundColor Green
}

# Check for merge conflict markers
$filesWithConflicts = Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { -not (Should-Exclude $_.FullName) } |
    Where-Object { Get-Content -LiteralPath $_.FullName -Raw | Select-String -Pattern '^<<<<<<< |^=======$|^>>>>>>> ' } |
    Select-Object -ExpandProperty FullName

if ($filesWithConflicts) {
    Write-Error "Files with merge conflict markers (must resolve manually):"
    $filesWithConflicts | ForEach-Object { Write-Error "  $_" }
    exit 1
} else {
    Write-Host "  No merge conflict markers" -ForegroundColor Green
}

# 3. Secret scanning (basic patterns)
Write-Host "`n[3/5] Scanning for secrets..." -ForegroundColor Yellow
$secretPatterns = @(
    'api[_-]?key\s*[:=]\s*["'']?[a-zA-Z0-9_\-]{20,}',
    'secret\s*[:=]\s*["'']?[a-zA-Z0-9_\-]{20,}',
    'token\s*[:=]\s*["'']?[a-zA-Z0-9_\-]{20,}',
    'password\s*[:=]\s*["'']?[a-zA-Z0-9_\-]{8,}',
    'aws[_-]?access[_-]?key\s*[:=]\s*["'']?[A-Z0-9]{20}',
    '-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----',
    'ssh-rsa\s+[A-Za-z0-9+/]+[=]{0,2}'
)

$filesWithSecrets = Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { -not (Should-Exclude $_.FullName) } |
    Where-Object { $_.Extension -notin '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz' } |
    Where-Object {
        $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        foreach ($pattern in $secretPatterns) {
            if ($content | Select-String -Pattern $pattern) { return $true }
        }
        return $false
    } |
    Select-Object -ExpandProperty FullName

if ($filesWithSecrets) {
    Write-Error "Potential secrets found in:"
    $filesWithSecrets | ForEach-Object { Write-Error "  $_" }
    Write-Error "If these are false positives, use a more specific pattern or add to .gitignore"
    exit 1
} else {
    Write-Host "  No secrets detected" -ForegroundColor Green
}

# 4. Markdown linting (if markdownlint-cli available via npx)
Write-Host "`n[4/5] Linting Markdown files..." -ForegroundColor Yellow
$mdFiles = Get-ChildItem -Path $repoRoot -Recurse -Filter '*.md' -File |
    Where-Object { -not (Should-Exclude $_.FullName) } |
    Where-Object { $_.FullName -notmatch '\\.git\\' } |
    Select-Object -ExpandProperty FullName

if ($mdFiles) {
    # Use npx markdownlint-cli if available
    $hasNode = Get-Command node -ErrorAction SilentlyContinue
    if ($hasNode) {
        $lintResult = & npx markdownlint-cli --config "$repoRoot\.markdownlint.jsonc" $mdFiles 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Markdown lint issues found (run 'npx markdownlint-cli --fix' to auto-fix):"
            $lintResult | ForEach-Object { Write-Warning $_ }
            # Don't fail on markdown lint warnings, just warn
        } else {
            Write-Host "  Markdown lint passed" -ForegroundColor Green
        }
    } else {
        Write-Host "  Node.js not found, skipping markdownlint" -ForegroundColor Gray
    }
} else {
    Write-Host "  No Markdown files" -ForegroundColor Gray
}

# 5. PowerShell Script Analyzer (if module available)
Write-Host "`n[5/5] Analyzing PowerShell scripts..." -ForegroundColor Yellow
$psFiles = Get-ChildItem -Path $repoRoot -Recurse -Filter '*.ps1' -File |
    Where-Object { $_.FullName -notmatch '\\.git\\' } |
    Select-Object -ExpandProperty FullName

if ($psFiles) {
    $hasPSA = Get-Module -ListAvailable -Name PSScriptAnalyzer
    if ($hasPSA) {
        Import-Module PSScriptAnalyzer -ErrorAction SilentlyContinue
        $issues = @()
        foreach ($file in $psFiles) {
            $fileIssues = Invoke-ScriptAnalyzer -Path $file -Severity Error,Warning -ExcludeRule @('PSAvoidUsingWriteHost', 'PSAvoidGlobalVars') -ErrorAction SilentlyContinue
            if ($fileIssues) { $issues += $fileIssues }
        }
        if ($issues) {
            Write-Warning "PowerShell Script Analyzer found issues:"
            $issues | Format-Table RuleName, Severity, Line, Message, ScriptName -AutoSize | Out-Host
            # Don't fail on warnings, just warn
        } else {
            Write-Host "  PowerShell analysis passed" -ForegroundColor Green
        }
    } else {
        Write-Host "  PSScriptAnalyzer not installed, skipping" -ForegroundColor Gray
    }
} else {
    Write-Host "  No PowerShell files" -ForegroundColor Gray
}

Write-Host "`nAll pre-commit checks passed!" -ForegroundColor Green
exit 0
