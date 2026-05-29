import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { rgPath } from '@vscode/ripgrep'

export interface RgSearchOptions {
  pattern: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface RgMatch {
  path: string
  line: number
  text: string
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

  constructor(private readonly config: Config) {}

  async search(options: RgSearchOptions): Promise<void> {
    this.ensureExportDirectoryIsAccessible()
    const ripgrepCommandArguments = this.constructRipgrepArguments(options)
    await this.spawnRipgrepProcess(ripgrepCommandArguments)
  }

  async captureSearchMatches(options: RgSearchOptions): Promise<RgMatch[]> {
    this.ensureExportDirectoryIsAccessible()

    const baseArguments = this.constructRipgrepArguments(options)
    const jsonOutputArguments = baseArguments
      .filter((arg) => arg !== '--color=always')
      .concat(['--color=never', '--json', '--max-filesize', '1M', '--no-binary'])

    return new Promise((resolve, reject) => {
      const MAX_MATCHES_PER_QUERY = 100
      const SEARCH_TIMEOUT_MS = 30000
      const matches: RgMatch[] = []

      const ripgrepProcess = spawn(rgPath, jsonOutputArguments, { cwd: this.config.exportDir })

      const timeoutId = setTimeout(() => {
        const timeoutSeconds = SEARCH_TIMEOUT_MS / 1000
        logger.warn(
          `Ripgrep search for "${options.pattern}" timed out after ${timeoutSeconds}s. Killing process.`
        )
        ripgrepProcess.kill('SIGKILL')
      }, SEARCH_TIMEOUT_MS)

      const readlineInterface = createInterface({
        input: ripgrepProcess.stdout,
        terminal: false,
      })

      readlineInterface.on('line', (line) => {
        if (matches.length >= MAX_MATCHES_PER_QUERY) {
          ripgrepProcess.kill()
          return
        }

        try {
          const parsedLine = JSON.parse(line)
          if (parsedLine.type === 'match') {
            matches.push({
              path: parsedLine.data.path.text,
              line: parsedLine.data.line_number,
              text: parsedLine.data.lines.text,
            })
          }
        } catch (_err) {
          // Ignore lines that are not valid JSON or of a different type
        }
      })

      ripgrepProcess.stderr.on('data', () => {
        // Silently consume stderr to avoid buffer filling up
      })

      ripgrepProcess.on('error', (processError) => {
        clearTimeout(timeoutId)
        readlineInterface.close()
        reject(processError)
      })

      ripgrepProcess.on('close', (exitCode) => {
        clearTimeout(timeoutId)
        readlineInterface.close()

        const isSuccessfulExit =
          exitCode === 0 || exitCode === 1 || exitCode === null || ripgrepProcess.killed
        if (isSuccessfulExit) {
          resolve(matches)
        } else {
          reject(new RgSearch.RgSearchError(`ripgrep exited with code ${exitCode}`))
        }
      })
    })
  }

  private ensureExportDirectoryIsAccessible(): void {
    const exportsExist = existsSync(this.config.exportDir)
    if (!exportsExist) {
      throw new RgSearch.RgSearchError(
        'No exports directory found. Please run the "start" command first to export your history.'
      )
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
      const ripgrepProcess = spawn(rgPath, args, {
        cwd: this.config.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let hasFoundMatches = false

      ripgrepProcess.stdout.on('data', (data) => {
        hasFoundMatches = true
        process.stdout.write(data)
      })

      ripgrepProcess.stderr.on('data', (data) => {
        const errorText = data.toString()
        const isNotNotFoundError = !errorText.includes('No such file or directory')
        if (isNotNotFoundError) {
          process.stderr.write(chalk.red(data))
        }
      })

      ripgrepProcess.on('error', (processError) => {
        const isMissingBinary = processError.message.includes('ENOENT')
        if (isMissingBinary) {
          reject(new RgSearch.RgNotFoundError(this.getRipgrepInstallationInstructions()))
        } else {
          reject(new RgSearch.RgSearchError(`Search failed: ${processError.message}`))
        }
      })

      ripgrepProcess.on('close', (exitCode) => {
        const isSuccessStatus = exitCode === 0 || exitCode === 1
        if (isSuccessStatus) {
          const isEmptyResult = exitCode === 1 && !hasFoundMatches
          if (isEmptyResult) {
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
      'Bundled ripgrep (rg) not found or failed to execute. ' +
      'Please ensure the application was installed correctly.'
    )
  }
}
