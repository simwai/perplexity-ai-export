import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'
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
  constructor(private readonly applicationConfig: Config) {}

  async search(searchOptions: RgSearchOptions): Promise<void> {
    this.ensureExportDirectoryExists()
    const ripgrepArguments = this.constructRipgrepArguments(searchOptions)
    await this.executeRipgrepProcess(ripgrepArguments)
  }

  async captureSearchMatches(searchOptions: RgSearchOptions): Promise<RgMatch[]> {
    this.ensureExportDirectoryExists()
    const ripgrepArguments = this.constructRipgrepArguments(searchOptions)
      .filter((argument) => argument !== '--color=always')
      .concat(['--color=never', '--json', '--max-filesize', '1M', '--no-binary'])

    return new Promise((resolve, reject) => {
      const MAXIMUM_MATCHES_TO_CAPTURE = 100
      const capturedMatches: RgMatch[] = []

      const ripgrepProcess = spawn(rgPath, ripgrepArguments, {
        cwd: this.applicationConfig.exportDir,
      })
      const readlineInterface = createInterface({ input: ripgrepProcess.stdout, terminal: false })

      const SEARCH_TIMEOUT_MILLISECONDS = 30000
      const timeoutId = setTimeout(() => {
        ripgrepProcess.kill()
        reject(new Error('ripgrep search timed out after 30 seconds'))
      }, SEARCH_TIMEOUT_MILLISECONDS)

      readlineInterface.on('line', (outputLine) => {
        if (capturedMatches.length >= MAXIMUM_MATCHES_TO_CAPTURE) {
          ripgrepProcess.kill()
          return
        }

        try {
          if (!outputLine.trim()) return
          const parsedJsonLine = JSON.parse(outputLine)
          if (parsedJsonLine.type === 'match') {
            capturedMatches.push({
              path: parsedJsonLine.data.path.text,
              line: parsedJsonLine.data.line_number,
              text: parsedJsonLine.data.lines.text,
            })
          }
        } catch (parsingError) {
          // Ignore invalid JSON lines from ripgrep
        }
      })

      ripgrepProcess.on('close', (exitCode) => {
        clearTimeout(timeoutId)
        if (exitCode === 0 || exitCode === 1 || ripgrepProcess.killed) {
          resolve(capturedMatches)
        } else {
          const errorMessage = `ripgrep exited with code ${exitCode}`
          errorBus.emitError(errorMessage)
          reject(new Error(errorMessage))
        }
      })

      ripgrepProcess.on('error', (processError) => {
        clearTimeout(timeoutId)
        errorBus.emitError('ripgrep failed to start', processError)
        reject(processError)
      })
    })
  }

  private ensureExportDirectoryExists() {
    if (!existsSync(this.applicationConfig.exportDir)) {
      errorBus.raiseError('No exports directory found. Please run export first.')
    }
  }

  private constructRipgrepArguments(searchOptions: RgSearchOptions): string[] {
    const ripgrepArguments = [
      '--color=never',
      '--heading',
      '--line-number',
      '--no-messages',
      '--column',
      '--smart-case',
    ]

    if (searchOptions.caseSensitive) {
      ripgrepArguments.push('--case-sensitive')
    }
    if (searchOptions.wholeWord) {
      ripgrepArguments.push('--word-regexp')
    }

    if (searchOptions.regex) {
      ripgrepArguments.push('--regexp', searchOptions.pattern)
    } else {
      ripgrepArguments.push('--fixed-strings', searchOptions.pattern)
    }

    ripgrepArguments.push('--type', 'markdown')
    // Search only in Markdown files within the current directory and its subdirectories
    ripgrepArguments.push('.')

    return ripgrepArguments
  }

  private executeRipgrepProcess(ripgrepArguments: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ripgrepProcess = spawn(rgPath, ripgrepArguments, {
        cwd: this.applicationConfig.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let hasFoundAnyMatches = false
      ripgrepProcess.stdout.on('data', (outputDataChunk) => {
        hasFoundAnyMatches = true
        process.stdout.write(outputDataChunk)
      })

      ripgrepProcess.on('close', (exitCode) => {
        if (exitCode === 0 || exitCode === 1) {
          if (exitCode === 1 && !hasFoundAnyMatches) {
            logger.info('No results found.')
          }
          resolve()
        } else {
          const errorMessage = `ripgrep exited with code ${exitCode}`
          errorBus.emitError(errorMessage)
          reject(new Error(errorMessage))
        }
      })

      ripgrepProcess.on('error', (processError) => {
        errorBus.emitError('ripgrep failed', processError)
        reject(processError)
      })
    })
  }
}
