import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'

export class BrowserManager {
  static readonly BrowserLaunchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'BrowserLaunchError'
    }
  }

  static readonly AuthError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AuthError'
    }
  }

  static readonly ContextError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ContextError'
    }
  }

  static readonly NavigationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NavigationError'
    }
  }

  public browserInstance: Browser | null = null
  private activeContext: BrowserContext | null = null
  private activePage: Page | null = null

  async launch(): Promise<Page> {
    try {
      await this.launchHeadfulBrowser()
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()
      await this.ensureUserIsAuthenticated()
      return this.getActivePage()
    } catch (_error) {
      if (_error instanceof Error) throw _error
      throw new BrowserManager.BrowserLaunchError(`Unexpected error: ${String(_error)}`)
    }
  }

  async close(): Promise<void> {
    if (this.activePage) await this.activePage.close().catch(() => {})
    if (this.activeContext) await this.activeContext.close().catch(() => {})
    if (this.browserInstance) await this.browserInstance.close().catch(() => {})
  }

  private async launchHeadfulBrowser(): Promise<void> {
    try {
      this.browserInstance = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (_error) {
      throw new BrowserManager.BrowserLaunchError(
        `Failed to launch browser: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async initializeBrowserContext(): Promise<void> {
    if (!this.browserInstance) throw new BrowserManager.ContextError('Browser not initialized')

    const authStoragePath = config.authStoragePath
    const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(authStoragePath)

    if (isSavedAuthValid) {
      logger.info('Loading saved authentication state...')
      try {
        const storageStateData = JSON.parse(readFileSync(authStoragePath, 'utf-8'))
        this.activeContext = await this.browserInstance.newContext({
          storageState: storageStateData,
        })
      } catch (_error) {
        logger.warn('Failed to load saved auth state, starting fresh.', _error)
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      if (existsSync(authStoragePath)) {
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
    } catch (_error) {
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
        waitUntil: 'networkidle',
      })
    } catch (_error) {
      throw new BrowserManager.NavigationError(
        `Failed to navigate to settings: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async ensureUserIsAuthenticated(): Promise<void> {
    if (!this.activePage) {
      throw new BrowserManager.AuthError('Page not initialized')
    }

    const authStoragePath = config.authStoragePath
    const isAuthFresh = this.checkIfSavedAuthenticationIsFresh(authStoragePath)

    if (isAuthFresh) {
      const isActuallyLoggedIn = await this.verifyLoginStatus(this.activePage)

      if (isActuallyLoggedIn) {
        logger.success('Already logged in!')
        return
      }
      logger.warn('Saved authentication expired or invalid.')
    }

    logger.info('Please log in manually in the browser window...')
    await confirm({
      message: 'Press Enter when you are logged in and on the settings page',
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
    if (authenticatedUrlPaths.some((path) => currentUrl.includes(path))) {
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
