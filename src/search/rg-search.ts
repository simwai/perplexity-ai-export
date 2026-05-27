import { errorBus } from '../utils/error-bus.js'
import { spawn } from 'node:child_process'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { rgPath } from '@vscode/ripgrep'
import chalk from 'chalk'
import { ErrorMessages } from '../utils/error-messages.js'

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

  async captureSearchMatches(options: RgSearchOptions): Promise<RgMatch[]> {
    const argumentsList = ['--json', '--max-count', '100']
    if (!options.caseSensitive) argumentsList.push('--ignore-case')
    if (options.wholeWord) argumentsList.push('--word-regexp')
    if (options.regex) {
      argumentsList.push('--regexp', options.pattern)
    } else {
      argumentsList.push('--fixed-strings', options.pattern)
    }
    argumentsList.push('--type', 'markdown')

    return new Promise((resolve, reject) => {
      const matches: RgMatch[] = []
      const ripgrepProcess = spawn(rgPath, argumentsList, { cwd: config.exportDir })

      const timeout = setTimeout(() => {
        ripgrepProcess.kill()
        reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.Timeout))
      }, 30000)

      ripgrepProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'match') {
              matches.push({
                path: parsed.data.path.text,
                line: parsed.data.line_number,
                text: parsed.data.lines.text,
              })
            }
          } catch (error) {
            /* ignore */
          }
        }
      })

      ripgrepProcess.on('error', (error) => {
        clearTimeout(timeout)
        if ((error as any).code === 'ENOENT') {
          reject(errorBus.raise(RgSearch.RgNotFoundError, ErrorMessages.Search.RgSearch.NotFound, error))
        } else {
          reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.GenericFailure, error))
        }
      })

      ripgrepProcess.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0 || code === 1) resolve(matches)
        else reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.ExitCode(code)))
      })
    })
  }

  async search(options: RgSearchOptions): Promise<void> {
    const argumentsList = this.buildArgumentsList(options)

    return new Promise((resolve, reject) => {
      const ripgrepProcess = spawn(rgPath, argumentsList, {
        cwd: config.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeout = setTimeout(() => {
        ripgrepProcess.kill()
        reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.Timeout))
      }, 30000)

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
        clearTimeout(timeout)
        if (error.message.includes('ENOENT')) {
          reject(
            errorBus.raise(
              RgSearch.RgNotFoundError,
              ErrorMessages.Search.RgSearch.NotFound,
              error
            )
          )
        } else {
          reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.GenericFailure, error))
        }
      })

      ripgrepProcess.on('close', (exitCode) => {
        clearTimeout(timeout)
        if (exitCode === 0 || exitCode === 1) {
          if (!matchedResultsFound && exitCode === 1) {
            logger.info('No results found.')
          }
          resolve()
        } else {
          reject(errorBus.raise(RgSearch.RgSearchError, ErrorMessages.Search.RgSearch.ExitCode(exitCode)))
        }
      })
    })
  }

  private buildArgumentsList(options: RgSearchOptions): string[] {
    const argumentsList = ['--heading', '--line-number', '--color', 'always']

    if (!options.caseSensitive) {
      argumentsList.push('--ignore-case')
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
}
