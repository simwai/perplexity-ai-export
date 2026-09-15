# test-self-review-protocol.ps1
# Static regression tests for the self-review protocol in 00-system.md
# Exit 0 on pass, non-zero on fail.

$ErrorActionPreference = 'Stop'
$systemFile = Join-Path $PSScriptRoot "..\00-system.md"
$pass = $true
$failures = @()

function Assert-Contains {
    param(
        [string]$Pattern,
        [string]$Description
    )
    $found = Select-String -Path $systemFile -Pattern $Pattern -SimpleMatch -Quiet
    if (-not $found) {
        $pass = $false
        $failures += "MISSING: $Description"
    }
}

# 1. Phase behavior: PLAN section present
Assert-Contains -Pattern "## Phase behavior: PLAN" -Description "PLAN phase behavior section"

# 2. PLAN section mentions read-only
Assert-Contains -Pattern "PLAN is read-only" -Description "PLAN read-only constraint"

# 3. PLAN section mentions zero exceptions
Assert-Contains -Pattern "Zero exceptions" -Description "PLAN zero exceptions"

# 4. PLAN section mentions transition to PATCH requires approval
Assert-Contains -Pattern "Transition to PATCH requires explicit user approval" -Description "PLAN transition gate"

# 5. Self-review protocol section present
Assert-Contains -Pattern "## Self-review protocol" -Description "Self-review protocol section"

# 6. Self-review mentions DISCUSS, PATCH, REVIEW
Assert-Contains -Pattern "DISCUSS, PATCH, and REVIEW" -Description "Self-review enabled phases"

# 7. Self-review mentions silent
Assert-Contains -Pattern "This pass is silent" -Description "Self-review is silent"

# 8. Self-review mentions senior engineer perspective
Assert-Contains -Pattern "senior engineer" -Description "Self-review perspective"

# 9. Self-review mentions auto-correct
Assert-Contains -Pattern "Auto-correct" -Description "Self-review auto-correct dimension"

# 10. Self-review skip list includes CHECKLIST
Assert-Contains -Pattern "Skip: CHECKLIST" -Description "Self-review skip list"

if ($pass) {
    Write-Host "PASS: self-review protocol static checks"
    exit 0
} else {
    Write-Host "FAIL: self-review protocol static checks"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
