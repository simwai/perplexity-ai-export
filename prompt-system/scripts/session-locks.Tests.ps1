<#
.SYNOPSIS
    Regression tests for session-locks.ps1 dependency discovery.
.DESCRIPTION
    Guards the importer and forward-import patterns: a consumer that imports
    the target must appear in Importers, and the target's own imports must
    appear in Imports. Discovery shells out to rg, which must be on PATH.
#>

BeforeAll {
    . $PSScriptRoot/session-locks.ps1
}

Describe 'Get-DependencySet' {
    BeforeAll {
        # Shared fixture: every Context below resolves against this file, so it
        # lives at Describe scope (a Context-scoped TestDrive would hide it).
        Set-Content -Path (Join-Path $TestDrive 'helper.ps1') -Value '# helper' -Encoding UTF8
    }

    Context 'leaf-name importer matching' {
        BeforeAll {
            Set-Content -Path (Join-Path $TestDrive 'consumer.ps1') -Value "import './helper.ps1'" -Encoding UTF8
        }

        It 'lists the importing file even though the import is relative' {
            $set = Get-DependencySet -RepoRoot $TestDrive -TargetFile 'helper.ps1'
            $set.Importers | Should -Contain 'consumer.ps1'
        }

        It 'leaves a file with no importers empty' {
            $set = Get-DependencySet -RepoRoot $TestDrive -TargetFile 'consumer.ps1'
            $set.Importers | Should -BeNullOrEmpty
        }
    }

    Context 'forward imports' {
        BeforeAll {
            Set-Content -Path (Join-Path $TestDrive 'main.ps1') -Value "require './helper.ps1'" -Encoding UTF8
        }

        It 'captures the imported path instead of quote characters' {
            $set = Get-DependencySet -RepoRoot $TestDrive -TargetFile 'main.ps1'
            $set.Imports | Should -Contain 'helper.ps1'
        }
    }
}
