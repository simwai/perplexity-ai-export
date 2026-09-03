import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
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
    await this.runRipgrep(options, { json: false })
  }

  async captureSearchMatches(options: RgSearchOptions): Promise<RgMatch[]> {
    return this.runRipgrep(options, { json: true }) as Promise<RgMatch[]>
  }

  private runRipgrep(
    options: RgSearchOptions,
    { json }: { json: boolean }
  ): Promise<void | RgMatch[]> {
    this.ensureExportDirectoryIsAccessible()

    const MAX_MATCHES = 100
    const TIMEOUT_MS = 15000
    const args = this.buildArgs(options, json)

    return new Promise((resolve, reject) => {
      const matches: RgMatch[] = []
      let hasOutput = false

      const child = spawn(rgPath, args, {
        cwd: this.config.exportDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeout = setTimeout(() => {
        logger.warn(`Ripgrep search timed out after ${TIMEOUT_MS / 1000}s. Killing process.`)
        child.kill('SIGKILL')
      }, TIMEOUT_MS)
      if (json) {
        const rl = createInterface({ input: child.stdout, terminal: false })
        rl.on('line', (line) => {
          if (matches.length >= MAX_MATCHES) {
            child.kill()
            return
          }
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
            logger.debug(`Failed to parse ripgrep JSON line: ${(error as Error).message}`)
          }
        })
        child.on('close', () => rl.close())
        child.on('error', () => rl.close())
      } else {
        child.stdout.on('data', (data) => {
          hasOutput = true
          process.stdout.write(data)
        })
        child.stderr.on('data', (data) => {
          const msg = data.toString()
          if (!msg.includes('No such file or directory')) {
            process.stderr.write(msg)
          }
        })
      }
      child.on('error', (err) => {
        clearTimeout(timeout)
        const isMissing = err.message.includes('ENOENT')
        reject(
          isMissing
            ? new RgSearch.RgNotFoundError(this.getRipgrepInstallationInstructions())
            : new RgSearch.RgSearchError(`Search failed: ${err.message}`)
        )
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        const isSuccess = code === 0 || code === 1 || child.killed
        if (isSuccess) {
          if (!json && code === 1 && !hasOutput) {
            logger.info('No results found.')
          }
          resolve(json ? matches : undefined)
        } else {
          reject(new RgSearch.RgSearchError(`ripgrep exited with code ${code}`))
        }
      })
    })
  }

  private buildArgs(options: RgSearchOptions, json: boolean): string[] {
    const args = [
      '--color=' + (json ? 'never' : 'always'),
      '--heading',
      '--line-number',
      '--no-messages',
      '--column',
      '--smart-case',
      '--no-ignore',
    ]

    if (options.caseSensitive) {
      args.push('--case-sensitive')
    }
    if (options.wholeWord) {
      args.push('--word-regexp')
    }
    if (options.regex) {
      args.push('--regexp', options.pattern)
    } else {
      args.push('--fixed-strings', options.pattern)
    }

    args.push('--type', 'markdown')

    if (json) {
      args.push('--json', '--max-filesize', '1M', '--no-binary')
    }

    return args
  }

  private ensureExportDirectoryIsAccessible(): void {
    if (!existsSync(this.config.exportDir)) {
      throw new RgSearch.RgSearchError(
        'No exports directory found. Please run the "start" command first to export your history.'
      )
    }
  }

  private getRipgrepInstallationInstructions(): string {
    return (
      'Bundled ripgrep (rg) not found or failed to execute. ' +
      'Please ensure the application was installed correctly.'
    )
  }
}
