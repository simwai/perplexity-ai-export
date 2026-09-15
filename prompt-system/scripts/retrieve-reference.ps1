<#
.SYNOPSIS
    Retrieves reference pool entries matching a query.
.DESCRIPTION
    Reads the global manifest.yaml, filters by language and domain, scores
    against primary/secondary/synonym tags, and returns the top N entries.
    Designed to be called by the /code-ref slash command.
#>

$ErrorActionPreference = 'Stop'

$script:POOL_ROOT = if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.config\opencode\reference-pool'
} else {
    Join-Path $env:HOME '.config\opencode\reference-pool'
}

$script:MANIFEST_PATH = Join-Path $script:POOL_ROOT 'manifest.yaml'

$script:SCORE_PRIMARY = 1.0
$script:SCORE_SECONDARY = 0.7
$script:SCORE_SYNONYM_CURATED = 0.3
$script:SCORE_SYNONYM_AI = 0.2

function Test-PoolInitialized {
    if (-not (Test-Path -LiteralPath $script:POOL_ROOT -PathType Container)) {
        throw "Reference pool not initialized at $script:POOL_ROOT. Run init-reference-pool.ps1 first."
    }
    if (-not (Test-Path -LiteralPath $script:MANIFEST_PATH -PathType Leaf)) {
        throw "manifest.yaml not found at $script:MANIFEST_PATH"
    }
}

function Read-Manifest {
    param([string]$Path)
    
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if (-not $content) { return @{ schema_version = ''; pool = @(); entries = @() } }
    
    # Minimal YAML parser for our specific schema. Supports:
    # - Top-level scalar: key: "value"
    # - List of scalars: key: [a, b, c]
    # - List of mappings: key: [ { k: v }, { k: v } ]
    # - Nested mappings with 2-space indent
    # Does NOT support multi-line strings, anchors, or complex YAML.
    
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
        
        # Top-level section: key: value or key: [items]
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
                # Inline list (single line)
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
                    # Start of multi-line list
                    $inList = $true
                    $listKey = $key
                    $currentSection = $key
                }
            } elseif ($value -match '^-') {
                # Start of list item
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
        
        # List item continuation: - value
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
        
        # Nested list item:   - key: value
        if ($line -match '^\s+-\s+([a-z_]+):\s*(.*)$' -and $nestDepth -gt 0) {
            $k = $matches[1]
            $v = $matches[2].Trim().Trim('"', "'")
            if ($currentItem.ContainsKey($nestKey)) {
                $currentItem[$nestKey] += @{ $k = $v }
            }
            continue
        }
        
        # Indented key: value inside list item
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
        
        # Nested list continuation inside synonym_map:   - key: [a, b]
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
    
    # Flush last item
    if ($currentSection -and $inList -and $currentItem.Count -gt 0) {
        if ($listKey -eq 'pool') { $result.pool += $currentItem }
        elseif ($listKey -eq 'entries') { $result.entries += $currentItem }
    }
    
    return $result
}

function Expand-Synonyms {
    param(
        [string[]]$Keywords,
        [hashtable]$SynonymMap
    )
    
    $expanded = @{}
    foreach ($kw in $Keywords) {
        $lower = $kw.ToLower()
        $expanded[$lower] = @{ Source = 'primary'; Score = $script:SCORE_PRIMARY }
        
        if ($SynonymMap.ContainsKey($lower)) {
            foreach ($syn in $SynonymMap[$lower]) {
                $expanded[$syn.ToLower()] = @{ Source = 'curated'; Score = $script:SCORE_SYNONYM_CURATED }
            }
        }
    }
    return $expanded
}

function Add-AiSynonyms {
    param(
        [hashtable]$Expanded,
        [string[]]$Keywords
    )
    
    # AI-generated synonyms: lowercase variants, plurals, common substitutions.
    # These are NOT stored in the manifest; generated at query time.
    $aiSynonymMap = @{
        'config' = @('configuration', 'settings', 'options', 'conf')
        'validation' = @('verify', 'check', 'assert', 'validate', 'verify')
        'coercion' = @('convert', 'transform', 'cast', 'parse')
        'schema' = @('shape', 'structure', 'type', 'definition')
        'error' = @('exception', 'failure', 'fault', 'issue')
        'handling' = @('management', 'processing', 'treatment')
        'auth' = @('authentication', 'authorization', 'login', 'identity')
        'api' = @('endpoint', 'route', 'interface', 'service')
        'test' = @('spec', 'testing', 'assertion', 'coverage')
        'cli' = @('command-line', 'terminal', 'shell', 'console')
    }
    
    foreach ($kw in $Keywords) {
        $lower = $kw.ToLower()
        if ($aiSynonymMap.ContainsKey($lower)) {
            foreach ($syn in $aiSynonymMap[$lower]) {
                if (-not $expanded.ContainsKey($syn.ToLower())) {
                    $expanded[$syn.ToLower()] = @{ Source = 'ai'; Score = $script:SCORE_SYNONYM_AI }
                }
            }
        }
    }
    return $expanded
}

function Score-Entry {
    param(
        [hashtable]$Entry,
        [hashtable]$ExpandedKeywords
    )
    
    $score = 0.0
    $reasons = @()
    
    $allTags = @()
    if ($Entry.primary_tags) { $allTags += $Entry.primary_tags }
    if ($Entry.secondary_tags) { $allTags += $Entry.secondary_tags }
    
    foreach ($tag in $allTags) {
        $lower = $tag.ToLower()
        if ($ExpandedKeywords.ContainsKey($lower)) {
            $info = $ExpandedKeywords[$lower]
            $score += $info.Score
            $reasons += "$($info.Source):$tag"
        }
    }
    
    return @{ Score = $score; Reasons = $reasons }
}

function Get-ReferencePoolMatches {
    <#
    .SYNOPSIS
        Returns top N reference pool entries matching a query.
    .PARAMETER Language
        Filter by language (e.g. typescript, python)
    .PARAMETER Domain
        Filter by domain (e.g. config-validation, error-handling)
    .PARAMETER Keywords
        Search keywords for scoring
    .PARAMETER PoolId
        Optional: restrict to a specific pool member
    .PARAMETER MaxResults
        Maximum entries to return (default 3)
    #>
    param(
        [Parameter(Mandatory)][string]$Language,
        [Parameter(Mandatory)][string]$Domain,
        [Parameter(Mandatory)][string[]]$Keywords,
        [string]$PoolId,
        [int]$MaxResults = 3
    )
    
    Test-PoolInitialized
    
    $manifest = Read-Manifest -Path $script:MANIFEST_PATH
    
    if ($manifest.schema_version -ne '1.0') {
        throw "Unsupported manifest schema_version: $($manifest.schema_version). Expected 1.0."
    }
    
    # Build pool member lookup
    $poolMembers = @{}
    foreach ($member in $manifest.pool) {
        $poolMembers[$member.id] = $member
    }
    
    # Filter pool members by language and domain
    $candidatePoolIds = @()
    if ($PoolId) {
        if ($poolMembers.ContainsKey($PoolId)) {
            $candidatePoolIds = @($PoolId)
        }
    } else {
        foreach ($member in $manifest.pool) {
            $langMatch = $false
            $domainMatch = $false
            if ($member.languages -contains $Language) { $langMatch = $true }
            if ($member.domains -contains $Domain) { $domainMatch = $true }
            if ($langMatch -and $domainMatch) {
                $candidatePoolIds += $member.id
            }
        }
    }
    
    if ($candidatePoolIds.Count -eq 0) {
        return @()
    }
    
    # Build expanded keyword set
    $expanded = Expand-Synonyms -Keywords $Keywords -SynonymMap @{}
    $expanded = Add-AiSynonyms -Expanded $expanded -Keywords $Keywords
    
    # Score entries
    $scored = @()
    foreach ($entry in $manifest.entries) {
        if ($candidatePoolIds -notcontains $entry.pool_id) { continue }
        if ($entry.language -and $entry.language -ne $Language) { continue }
        if ($entry.domain -and $entry.domain -ne $Domain) { continue }
        
        $result = Score-Entry -Entry $entry -ExpandedKeywords $expanded
        if ($result.Score -le 0) { continue }
        
        $poolMember = $poolMembers[$entry.pool_id]
        $scored += [ordered]@{
            Entry = $entry
            PoolMember = $poolMember
            Score = $result.Score
            Reasons = $result.Reasons
        }
    }
    
    # Sort by score descending, take top N
    $scored | Sort-Object -Property Score -Descending | Select-Object -First $MaxResults
}

# No Export-ModuleMember: this script is dot-sourced or invoked directly.
