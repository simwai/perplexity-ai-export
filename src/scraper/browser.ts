import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { confirm } from '@inquirer/prompts'

export class BrowserManager {
  static readonly BrowserLaunchError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'BrowserLaunchError'
    }
  }

  static readonly AuthError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'AuthError'
    }
  }

  static readonly ContextError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'ContextError'
    }
  }

  static readonly NavigationError = class extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = 'NavigationError'
    }
  }

  browserInstance: Browser | null = null
  private activeContext: BrowserContext | null = null
  private activePage: Page | null = null

  async launch(): Promise<Page> {
    const { headless } = config

    try {
      // Launch headful if no valid auth to let user login
      const isAuthFresh = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)

      await this.launchBrowser(isAuthFresh ? headless : false)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()

      await this.ensureUserIsAuthenticated()

      // If user wants headless, restart now that we are logged in
      if (headless !== false && isAuthFresh === false) {
        logger.info('Authentication successful. Restarting in headless mode...')
        await this.close()
        await this.launchBrowser(headless)
        await this.initializeBrowserContext()
        await this.navigateToSettingsPage()
      }

      return this.getActivePage()
    } catch (error) {
      if (error instanceof Error && error.name !== 'Error') throw error
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new BrowserManager.BrowserLaunchError(`Unexpected error: ${errorMessage}`, {
        cause: error,
      })
    }
  }

  async close(): Promise<void> {
    if (this.activePage) await this.activePage.close().catch(() => {})
    if (this.activeContext) await this.activeContext.close().catch(() => {})
    if (this.browserInstance) await this.browserInstance.close().catch(() => {})
    this.activePage = null
    this.activeContext = null
    this.browserInstance = null
  }

  private async launchBrowser(headless: boolean | 'new'): Promise<void> {
    try {
      this.browserInstance = await chromium.launch({
        headless: headless === 'new' ? true : headless,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new BrowserManager.BrowserLaunchError(`Failed to launch browser: ${errorMessage}`, {
        cause: error,
      })
    }
  }

  private async initializeBrowserContext(): Promise<void> {
    if (!this.browserInstance) throw new BrowserManager.ContextError('Browser not initialized')

    const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)

    if (isSavedAuthValid) {
      logger.info('Loading saved authentication state...')
      try {
        const storageStateData = JSON.parse(readFileSync(config.authStoragePath, 'utf-8'))
        this.activeContext = await this.browserInstance.newContext({
          storageState: storageStateData,
        })
      } catch (error) {
        logger.warn('Failed to load saved auth state, starting fresh.', error)
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      if (existsSync(config.authStoragePath)) {
        logger.info('Saved authentication is older than 1 day, discarding.')
      }
      this.activeContext = await this.browserInstance.newContext()
    }
  }

  private checkIfSavedAuthenticationIsFresh(path: string): boolean {
    if (!existsSync(path)) return false
    try {
      const fileStats = statSync(path)
      const fileAgeInMs = Date.now() - fileStats.mtimeMs
      const twentyFourHoursInMs = 24 * 60 * 60 * 1000
      return fileAgeInMs < twentyFourHoursInMs
    } catch (error) {
      return false
    }
  }

  private async navigateToSettingsPage(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.NavigationError('No browser context available')
    }
    this.activePage = await this.activeContext.newPage()
    const perplexitySettingsUrl = 'https://www.perplexity.ai/settings'
    try {
      await this.activePage.goto(perplexitySettingsUrl, {
        timeout: 30000,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new BrowserManager.NavigationError(`Failed to navigate to settings: ${errorMessage}`, {
        cause: error,
      })
    }
  }

  private async ensureUserIsAuthenticated(): Promise<void> {
    if (!this.activePage) {
      throw new BrowserManager.AuthError('Page not initialized')
    }

    const isActuallyLoggedIn = await this.verifyLoginStatus(this.activePage)

    if (isActuallyLoggedIn) {
      logger.success('Already logged in!')
      return
    }

    logger.info('Please log in manually in the browser window...')

    await confirm({
      message: 'Press Enter once you have logged in and see your settings page.',
      default: true,
    })

    const perplexitySettingsUrl = 'https://www.perplexity.ai/settings'
    await this.activePage.goto(perplexitySettingsUrl, {
      waitUntil: 'networkidle',
    })

    const isLoginSuccessfulNow = await this.verifyLoginStatus(this.activePage)
    if (!isLoginSuccessfulNow) {
      throw new BrowserManager.AuthError(
        `Login verification failed. Current URL: ${this.activePage.url()}`
      )
    }

    await this.persistAuthenticationState()
    logger.success('Authentication state saved!')
  }

  private async verifyLoginStatus(page: Page): Promise<boolean> {
    await page.waitForTimeout(1000).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const currentUrl = page.url()

    const authenticatedUrlPaths = ['/settings', '/library', '/collections', '/account/details']
    if (authenticatedUrlPaths.some((p) => currentUrl.includes(p))) {
      return true
    }

    const userMenuElementCount = await page
      .locator('[data-testid="user-menu"]')
      .count()
      .catch(() => 0)

    return userMenuElementCount > 0
  }

  private async persistAuthenticationState(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.AuthError('No browser context available to save')
    }
    const currentStorageState = await this.activeContext.storageState()
    writeFileSync(config.authStoragePath, JSON.stringify(currentStorageState, null, 2))
  }

  private getActivePage(): Page {
    if (!this.activePage) {
      throw new BrowserManager.ContextError('Page not initialized')
    }
    return this.activePage
  }
}
