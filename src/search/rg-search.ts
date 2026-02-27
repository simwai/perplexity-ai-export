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
  async search(options: RgSearchOptions): Promise<void> {
    if (!existsSync(config.exportDir)) {
      logger.error('No exports directory found. Run "start" command first.')
      return
    }

    const args = this.buildRgArgs(options)

    return new Promise((resolve, reject) => {
      const rg = spawn('rg', args, {
        cwd: config.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let hasResults = false

      rg.stdout.on('data', (data) => {
        hasResults = true
        process.stdout.write(data)
      })

      rg.stderr.on('data', (data) => {
        const errorMsg = data.toString()
        if (!errorMsg.includes('No such file or directory')) {
          process.stderr.write(chalk.red(data))
        }
      })

      rg.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          logger.error('ripgrep (rg) not found. Please install it:')
          logger.info('  macOS: brew install ripgrep')
          logger.info('  Linux: apt install ripgrep / dnf install ripgrep')
          logger.info('  Windows: choco install ripgrep / scoop install ripgrep')
        } else {
          logger.error(`Search failed: ${error.message}`)
        }
        reject(error)
      })

      rg.on('close', (code) => {
        if (code === 0 || code === 1) {
          if (!hasResults && code === 1) {
            logger.info('No results found.')
          }
          resolve()
        } else {
          reject(new Error(`rg exited with code ${code}`))
        }
      })
    })
  }

  private buildRgArgs(options: RgSearchOptions): string[] {
    const args: string[] = [
      '--color=always',
      '--heading',
      '--line-number',
      '--no-messages',
      '--column',
      '--smart-case',
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

    return args
  }
}
