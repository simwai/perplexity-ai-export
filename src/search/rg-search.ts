import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { rgPath } from '@vscode/ripgrep'
import { createNamedError } from '../utils/errors.js'
import { z } from 'zod'
import { createResult, ok, err, type Result } from 'super-result'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'

// why: ripgrep emits this exact substring on stderr when the binary is missing or unreadable
const RIPGREP_ENOENT_MESSAGE = 'No such file or directory'

const RipgrepMatchJsonSchema = z.object({
  type: z.literal('match'),
  data: z.object({
    path: z.object({ text: z.string() }),
    line_number: z.number(),
    lines: z.object({ text: z.string() }),
  }),
})

export interface RipgrepSearchOptions {
  pattern: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface RipgrepMatch {
  path: string
  line: number
  text: string
}

export class RipgrepSearch {
  static readonly RipgrepSearchError = createNamedError('RipgrepSearchError')
  static readonly RipgrepNotFoundError = createNamedError('RipgrepNotFoundError')

  private readonly resultFactory = createResult<Error>((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  )
  private readonly config: Config
  private readonly diagnosticsWriter: ApiDiagnosticsWriter

  constructor(config: Config) {
    this.config = config
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
  }

  async search(options: RipgrepSearchOptions): Promise<Result<void, Error>> {
    const validationResult = this.validateSearchOptions(options)
    if (!validationResult.ok) {
      return validationResult
    }
    return this.runRipgrep(options, { json: false }) as Promise<Result<void, Error>>
  }

  async captureSearchMatches(
    options: RipgrepSearchOptions
  ): Promise<Result<RipgrepMatch[], Error>> {
    const validationResult = this.validateSearchOptions(options)
    if (!validationResult.ok) {
      return validationResult
    }
    return this.runRipgrep(options, { json: true }) as Promise<Result<RipgrepMatch[], Error>>
  }

  private validateSearchOptions(options: RipgrepSearchOptions): Result<void, Error> {
    if (!options.pattern || options.pattern.trim().length === 0) {
      return err(new RipgrepSearch.RipgrepSearchError('Search pattern must not be empty'))
    }
    return ok(undefined)
  }

  private async runRipgrep(
    options: RipgrepSearchOptions,
    { json }: { json: boolean }
  ): Promise<Result<void | RipgrepMatch[], Error>> {
    const checkResult = this.resultFactory.from(() => ensureExportDirExists(this.config.exportDir))
    if (!checkResult.ok) return checkResult

    const MAX_MATCHES = 100
    const TIMEOUT_MS = 15000
    const args = this.buildArgs(options, json)

    return new Promise<Result<void | RipgrepMatch[], Error>>((resolve) => {
      const matches: RipgrepMatch[] = []
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
          const parsed = RipgrepMatchJsonSchema.safeParse(JSON.parse(line))
          if (parsed.success && parsed.data.type === 'match') {
            matches.push({
              path: parsed.data.data.path.text,
              line: parsed.data.data.line_number,
              text: parsed.data.data.lines.text,
            })
          } else {
            const paths = parsed.success
              ? undefined
              : parsed.error.issues.map((issue) => issue.path.join('.'))
            this.diagnosticsWriter.writeFailure({
              url: 'rg://search-line',
              errorType: 'zod_error',
              zodErrorPaths: paths,
            })
            logger.debug(`Failed to parse ripgrep JSON line`)
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
          const errorMessage = data.toString()
          if (!errorMessage.includes(RIPGREP_ENOENT_MESSAGE)) {
            process.stderr.write(errorMessage)
          }
        })
      }
      child.on('error', (error) => {
        clearTimeout(timeout)
        const isMissing = error.message.includes('ENOENT')
        resolve(
          err(
            isMissing
              ? new RipgrepSearch.RipgrepNotFoundError(this.getRipgrepInstallationInstructions())
              : new RipgrepSearch.RipgrepSearchError(`Search failed: ${error.message}`)
          )
        )
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        const isSuccess = code === 0 || code === 1 || child.killed
        if (isSuccess) {
          if (!json && code === 1 && !hasOutput) {
            logger.info('No results found.')
          }
          resolve(ok(json ? matches : undefined))
        } else {
          resolve(err(new RipgrepSearch.RipgrepSearchError(`ripgrep exited with code ${code}`)))
        }
      })
    })
  }

  private buildArgs(options: RipgrepSearchOptions, json: boolean): string[] {
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

  private getRipgrepInstallationInstructions(): string {
    return (
      'Bundled ripgrep (rg) not found or failed to execute. ' +
      'Please ensure the application was installed correctly.'
    )
  }
}

function ensureExportDirExists(exportDir: string): Result<void, Error> {
  if (!existsSync(exportDir)) {
    return err(
      new RipgrepSearch.RipgrepSearchError(
        'No exports directory found. Please run the "start" command first to export your history.'
      )
    )
  }
  return ok(undefined)
}
