import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

export interface RgSearchOptions {
  pattern: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export class RgSearch {
  static readonly RgSearchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RgSearchError'
    }
  }

  static readonly RgNotFoundError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RgNotFoundError'
    }
  }

  async search(options: RgSearchOptions): Promise<void> {
    this.ensureExportDirectoryIsAccessible()
    const ripgrepCommandArguments = this.constructRipgrepArguments(options)
    await this.spawnRipgrepProcess(ripgrepCommandArguments)
  }

  private ensureExportDirectoryIsAccessible(): void {
    if (!existsSync(config.exportDir)) {
      throw new RgSearch.RgSearchError('No exports directory found. Please run the "start" command first to export your history.')
    }
  }

  private constructRipgrepArguments(options: RgSearchOptions): string[] {
    const argumentsList: string[] = [
      '--color=always',
      '--heading',
      '--line-number',
      '--no-messages',
      '--column',
      '--smart-case',
    ]

    if (options.caseSensitive) {
      argumentsList.push('--case-sensitive')
    }

    if (options.wholeWord) {
      argumentsList.push('--word-regexp')
    }

    if (options.regex) {
      argumentsList.push('--regexp', options.pattern)
    } else {
      argumentsList.push('--fixed-strings', options.pattern)
    }

    argumentsList.push('--type', 'markdown')
    return argumentsList
  }

  private spawnRipgrepProcess(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ripgrepProcess = spawn('rg', args, {
        cwd: config.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let matchedResultsFound = false

      ripgrepProcess.stdout.on('data', (data) => {
        matchedResultsFound = true
        process.stdout.write(data)
      })

      ripgrepProcess.stderr.on('data', (data) => {
        const errorText = data.toString()
        if (!errorText.includes('No such file or directory')) {
          process.stderr.write(chalk.red(data))
        }
      })

      ripgrepProcess.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new RgSearch.RgNotFoundError(this.getRipgrepInstallationInstructions()))
        } else {
          reject(new RgSearch.RgSearchError(`Search failed: ${error.message}`))
        }
      })

      ripgrepProcess.on('close', (exitCode) => {
        if (exitCode === 0 || exitCode === 1) {
          if (!matchedResultsFound && exitCode === 1) {
            logger.info('No results found.')
          }
          resolve()
        } else {
          reject(new RgSearch.RgSearchError(`ripgrep exited with code ${exitCode}`))
        }
      })
    })
  }

  private getRipgrepInstallationInstructions(): string {
    return (
      'ripgrep (rg) not found. Please install it to use exact text search:\n' +
      '  macOS: brew install ripgrep\n' +
      '  Linux: apt install ripgrep / dnf install ripgrep\n' +
      '  Windows: choco install ripgrep / scoop install ripgrep'
    )
  }
}
