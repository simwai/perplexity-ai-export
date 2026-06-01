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
  constructor(private readonly config: Config) {}

  async search(options: RgSearchOptions): Promise<void> {
    this.ensureDir()
    const args = this.getArgs(options)
    await this.run(args)
  }

  async captureSearchMatches(options: RgSearchOptions): Promise<RgMatch[]> {
    this.ensureDir()
    const args = this.getArgs(options).filter(a => a !== '--color=always')
      .concat(['--color=never', '--json', '--max-filesize', '1M', '--no-binary'])

    return new Promise((resolve, reject) => {
      const MAX = 100
      const matches: RgMatch[] = []
      const child = spawn(rgPath, args, { cwd: this.config.exportDir })
      const rl = createInterface({ input: child.stdout, terminal: false })

      rl.on('line', (line) => {
        if (matches.length >= MAX) { child.kill(); return }
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'match') {
            matches.push({
              path: parsed.data.path.text,
              line: parsed.data.line_number,
              text: parsed.data.lines.text,
            })
          }
        } catch {}
      })

      child.on('close', (code) => {
        if (code === 0 || code === 1 || child.killed) resolve(matches)
        else reject(new Error(`ripgrep exited with code ${code}`))
      })
    })
  }

  private ensureDir() {
    if (!existsSync(this.config.exportDir)) {
      throw new Error('No exports directory found. Please run export first.')
    }
  }

  private getArgs(opt: RgSearchOptions): string[] {
    const args = ['--color=always', '--heading', '--line-number', '--no-messages', '--column', '--smart-case']
    if (opt.caseSensitive) args.push('--case-sensitive')
    if (opt.wholeWord) args.push('--word-regexp')
    if (opt.regex) args.push('--regexp', opt.pattern)
    else args.push('--fixed-strings', opt.pattern)
    args.push('--type', 'markdown')
    return args
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(rgPath, args, { cwd: this.config.exportDir, stdio: ['ignore', 'pipe', 'pipe'] })
      let found = false
      child.stdout.on('data', d => { found = true; process.stdout.write(d) })
      child.on('close', code => {
        if (code === 0 || code === 1) {
          if (code === 1 && !found) logger.info('No results found.')
          resolve()
        } else reject(new Error(`ripgrep exited with code ${code}`))
      })
    })
  }
}
