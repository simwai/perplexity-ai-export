<#
.SYNOPSIS
    Build a LaTeX file to PDF for arXiv-style papers.
.DESCRIPTION
    Compiles a .tex file to PDF using pdflatex or latexmk.
    Checks for LaTeX installation and reports clear errors if missing.
.EXAMPLE
    .\build-arxiv-pdf.ps1 -TexPath paper.tex
.EXAMPLE
    .\build-arxiv-pdf.ps1 -TexPath paper.tex -OutputDir output
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$TexPath,

    [string]$OutputDir,

    [switch]$UseLatexmk
)

$ErrorActionPreference = 'Stop'

# Resolve paths
$texPath = Resolve-Path -LiteralPath $TexPath -ErrorAction Stop
$texDir = Split-Path -Parent $texPath.Path

if (-not $OutputDir) {
    $OutputDir = $texDir
} else {
    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
}

# Check for LaTeX installation
$pdflatex = Get-Command pdflatex -ErrorAction SilentlyContinue
$latexmk = Get-Command latexmk -ErrorAction SilentlyContinue

if ($UseLatexmk -and $latexmk) {
    $compiler = 'latexmk'
    $compilerPath = $latexmk.Path
} elseif ($pdflatex) {
    $compiler = 'pdflatex'
    $compilerPath = $pdflatex.Path
} else {
    Write-Error "LaTeX is not installed. Please install TeX Live or MiKTeX and ensure pdflatex or latexmk is in PATH."
    exit 1
}

Write-Host "Using compiler: $compiler" -ForegroundColor Cyan

# Build command
$texFile = $texPath.Path
$baseName = [IO.Path]::GetFileNameWithoutExtension($texFile)

if ($compiler -eq 'latexmk') {
    $args = @(
        '-pdf',
        '-interaction=nonstopmode',
        '-halt-on-error',
        "-output-directory=$OutputDir",
        $texFile
    )
} else {
    $args = @(
        '-interaction=nonstopmode',
        "-output-directory=$OutputDir",
        $texFile
    )
}

Push-Location -LiteralPath $texDir
try {
    Write-Host "Compiling $texFile ..." -ForegroundColor Yellow
    & $compilerPath $args
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-Warning "Compilation exited with code $exitCode. Check the log for errors."
    } else {
        $pdfPath = Join-Path $OutputDir ($baseName + '.pdf')
        if (Test-Path -LiteralPath $pdfPath) {
            Write-Host "PDF generated: $pdfPath" -ForegroundColor Green
            exit 0
        } else {
            Write-Warning "Compilation completed but PDF not found at expected location."
            exit 1
        }
    }
} finally {
    Pop-Location
}
