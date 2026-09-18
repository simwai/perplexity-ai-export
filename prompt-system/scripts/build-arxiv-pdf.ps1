<#
.SYNOPSIS
    Build a LaTeX file to PDF for arXiv-style papers.
.DESCRIPTION
    Compiles a .tex file to PDF using pdflatex or latexmk.
    If LaTeX is not installed, attempts automatic installation via winget.
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

function Install-LaTeX {
    <#
    .SYNOPSIS
        Attempts to install MiKTeX via winget.
    #>
    Write-Host "LaTeX not found. Attempting automatic installation via winget..." -ForegroundColor Yellow

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Error "winget is not available. Please install winget or install MiKTeX manually from https://miktex.org/download."
        exit 1
    }

    Write-Host "Installing MiKTeX.MiKTeX..." -ForegroundColor Cyan
    & winget install --id MiKTeX.MiKTeX --accept-source-agreements --accept-package-agreements
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-Error "Automatic LaTeX installation failed with exit code $exitCode. Please install TeX Live or MiKTeX manually."
        exit 1
    }

    Write-Host "MiKTeX installed successfully. You may need to restart your terminal for the PATH to take effect." -ForegroundColor Green

    # Refresh PATH for current session
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
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
    Install-LaTeX

    # Re-check after installation
    $pdflatex = Get-Command pdflatex -ErrorAction SilentlyContinue
    $latexmk = Get-Command latexmk -ErrorAction SilentlyContinue

    if ($UseLatexmk -and $latexmk) {
        $compiler = 'latexmk'
        $compilerPath = $latexmk.Path
    } elseif ($pdflatex) {
        $compiler = 'pdflatex'
        $compilerPath = $pdflatex.Path
    } else {
        Write-Error "LaTeX installation completed, but pdflatex/latexmk is still not available. Please restart your terminal and try again."
        exit 1
    }
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
