import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'

export class BrowserManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  async launch(): Promise<Page> {
    const hasAuthState = existsSync(config.authStoragePath)

    this.browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })

    if (hasAuthState) {
      logger.info('Loading saved authentication state...')
      const storageState = JSON.parse(readFileSync(config.authStoragePath, 'utf-8'))
      this.context = await this.browser.newContext({ storageState })
    } else {
      this.context = await this.browser.newContext()
    }

    this.page = await this.context.newPage()

    await this.page.goto('https://www.perplexity.ai/settings')

    if (!hasAuthState) {
      logger.warn('No saved authentication found.')
      logger.info('Please log in manually in the browser window...')

      await confirm({
        message: 'Press Enter when you are logged in and on the settings page',
        default: true,
      })

      await this.saveAuthState()
      logger.success('Authentication state saved!')
    } else {
      const isLoggedIn = await this.verifyLogin(this.page)

      if (!isLoggedIn) {
        logger.warn('Saved authentication expired or invalid.')
        logger.info('Please log in manually...')

        await confirm({
          message: 'Press Enter when you are logged in',
          default: true,
        })

        await this.saveAuthState()
        logger.success('Authentication state updated!')
      } else {
        logger.success('Already logged in!')
      }
    }

    return this.page
  }

  private async verifyLogin(page: Page): Promise<boolean> {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const url = page.url()
    return url.includes('/settings') || url.includes('/collections')
  }

  private async saveAuthState(): Promise<void> {
    if (!this.context) {
      throw new Error('No browser context available to save')
    }
    const storageState = await this.context.storageState()
    writeFileSync(config.authStoragePath, JSON.stringify(storageState, null, 2))
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close()
    }
    if (this.context) {
      await this.context.close()
    }
    if (this.browser) {
      await this.browser.close()
    }
  }
}
