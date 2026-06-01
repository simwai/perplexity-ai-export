import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { readFileSync, existsSync, statSync } from 'node:fs'
import writeFileAtomic from 'write-file-atomic'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'
import { logHttpRequest, logHttpResponse } from '../utils/http-logger.js'

export class BrowserManager {
  public browserInstance: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(private readonly config: Config) {}

  async launch(): Promise<Page> {
    const fresh = this.isFresh(this.config.authStoragePath)
    if (fresh) {
      await this.init(this.config.headless)
      if (await this.isAuth()) {
        logger.success('Already logged in!')
        return this.page!
      }
      logger.warn('Session invalid. Restarting for login...')
      await this.close()
    }

    await this.init(false)
    await this.ensureAuth()

    if (this.config.headless !== false) {
      logger.info('Auth successful. Restarting in headless...')
      await this.close()
      await this.init(this.config.headless)
    }
    return this.page!
  }

  async close(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {})
    if (this.context) await this.context.close().catch(() => {})
    if (this.browserInstance) await this.browserInstance.close().catch(() => {})
    this.page = null; this.context = null; this.browserInstance = null
  }

  private async init(headless: boolean | 'new') {
    const h = headless === 'new' ? true : headless
    this.browserInstance = await chromium.launch({ headless: h })

    const fresh = this.isFresh(this.config.authStoragePath)
    const opts = fresh ? { storageState: JSON.parse(readFileSync(this.config.authStoragePath, 'utf8')) } : {}
    this.context = await this.browserInstance.newContext(opts)

    if (this.config.debug) {
      this.context.on('request', r => {
        if (r.url().includes('perplexity.ai') && !r.url().includes('static')) logHttpRequest(r, true)
      })
      this.context.on('response', r => {
        if (r.url().includes('perplexity.ai') && !r.url().includes('static')) logHttpResponse(r, true)
      })
    }
    this.page = await this.context.newPage()
    await this.page.goto('https://www.perplexity.ai/settings', { timeout: 15000 }).catch(() => {})
  }

  private isFresh(p: string): boolean {
    if (!existsSync(p)) return false
    return (Date.now() - statSync(p).mtimeMs) < 24 * 60 * 60 * 1000
  }

  private async isAuth(): Promise<boolean> {
    if (!this.page) return false
    const res = await this.page.evaluate(async () => {
      try {
        const r = await fetch('/api/auth/session')
        return await r.json()
      } catch { return {} }
    })
    return !!(res.user || res.expires)
  }

  private async ensureAuth() {
    if (await this.isAuth()) return
    logger.info('Please log in manually...')
    await confirm({ message: 'Press Enter when logged in and on settings page' })
    await this.page!.goto('https://www.perplexity.ai/settings', { waitUntil: 'networkidle' })
    if (!(await this.isAuth())) throw new Error('Login failed')
    await this.save()
    logger.success('Auth saved!')
  }

  private async save() {
    if (!this.context) return
    const state = await this.context.storageState()
    if (state.cookies.length > 0) {
      await (writeFileAtomic as any)(this.config.authStoragePath, JSON.stringify(state, null, 2))
    }
  }
}
