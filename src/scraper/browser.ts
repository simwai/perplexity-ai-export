import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'

export class BrowserManager {
  // ========== Custom Error Classes ==========
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

  public browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  // ========== Public API ==========

  /**
   * Launches the browser, handles authentication (saved or manual),
   * and returns a page ready for scraping.
   * @throws {BrowserManager.BrowserLaunchError} if browser cannot be launched.
   * @throws {BrowserManager.AuthError} if authentication fails.
   * @throws {BrowserManager.NavigationError} if navigation to settings fails.
   */
  async launch(): Promise<Page> {
    try {
      await this.launchBrowser()
      await this.createContext()
      await this.navigateToSettings()
      await this.handleAuthentication()
      return this.getPage()
    } catch (error) {
      if (error instanceof Error) throw error
      throw new BrowserManager.BrowserLaunchError(`Unexpected error: ${String(error)}`)
    }
  }

  /**
   * Closes the browser and all associated contexts/pages.
   */
  async close(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {})
    if (this.context) await this.context.close().catch(() => {})
    if (this.browser) await this.browser.close().catch(() => {})
  }

  // ========== Private Methods ==========

  /**
   * Launches the Chromium browser in non‑headless mode with anti‑detection args.
   */
  private async launchBrowser(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (error) {
      throw new BrowserManager.BrowserLaunchError(
        `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Creates a browser context, optionally loading saved auth state if it exists and is fresh.
   */
  private async createContext(): Promise<void> {
    if (!this.browser) throw new BrowserManager.ContextError('Browser not initialized')

    const authPath = config.authStoragePath
    const hasValidAuth = this.hasValidAuthState(authPath)

    if (hasValidAuth) {
      logger.info('Loading saved authentication state...')
      try {
        const storageState = JSON.parse(readFileSync(authPath, 'utf-8'))
        this.context = await this.browser.newContext({ storageState })
      } catch (error) {
        logger.warn('Failed to load saved auth state, starting fresh.', error)
        this.context = await this.browser.newContext()
      }
    } else {
      if (existsSync(authPath)) {
        logger.info('Saved authentication is older than 1 day, discarding.')
      }
      this.context = await this.browser.newContext()
    }
  }

  /**
   * Checks whether the auth state file exists and is younger than 1 day.
   */
  private hasValidAuthState(authPath: string): boolean {
    if (!existsSync(authPath)) return false
    try {
      const stats = statSync(authPath)
      const ageMs = Date.now() - stats.mtimeMs
      const oneDayMs = 24 * 60 * 60 * 1000
      return ageMs < oneDayMs
    } catch {
      return false
    }
  }

  /**
   * Navigates to the settings page; used as a login checkpoint.
   */
  private async navigateToSettings(): Promise<void> {
    if (!this.context) {
      throw new BrowserManager.NavigationError('No browser context available')
    }
    this.page = await this.context.newPage()
    try {
      const response = await this.page.goto('https://www.perplexity.ai/settings', {
        waitUntil: 'networkidle', // Wait for all network activity to settle
      })
      // Log response status for debugging
      if (response) {
        logger.debug(`Settings page status: ${response.status()}`)
      }
    } catch (error) {
      throw new BrowserManager.NavigationError(
        `Failed to navigate to settings: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Handles the authentication flow:
   * - If valid auth exists, verify it works; if not, prompt manual login.
   * - If no valid auth, prompt manual login.
   * - After successful manual login, save the new auth state.
   */
  private async handleAuthentication(): Promise<void> {
    if (!this.page) {
      throw new BrowserManager.AuthError('Page not initialized')
    }

    const authPath = config.authStoragePath
    const hasValidAuth = this.hasValidAuthState(authPath)

    if (hasValidAuth) {
      logger.debug(`Current URL before verification: ${this.page.url()}`)
      const isLoggedIn = await this.verifyLogin(this.page)
      logger.debug(`Login verification result: ${isLoggedIn}`)

      if (isLoggedIn) {
        logger.success('Already logged in!')
        return
      }
      logger.warn('Saved authentication expired or invalid.')
    }

    // No valid auth – guide user through manual login
    logger.info('Please log in manually in the browser window...')
    await confirm({
      message: 'Press Enter when you are logged in and on the settings page',
      default: true,
    })

    // Explicitly navigate to settings again to ensure we're on the right page
    await this.page.goto('https://www.perplexity.ai/settings', {
      waitUntil: 'networkidle',
    })

    const isLoggedInNow = await this.verifyLogin(this.page)
    if (!isLoggedInNow) {
      // Take a screenshot for debugging
      const screenshotPath = 'login-failure.png'
      await this.page.screenshot({ path: screenshotPath })
      logger.error(`Screenshot saved to ${screenshotPath}`)

      throw new BrowserManager.AuthError(
        `Login verification failed. Current URL: ${this.page.url()}`
      )
    }

    await this.saveAuthState()
    logger.success('Authentication state saved!')
  }

  /**
   * Verifies that the user is logged in by checking the current URL and presence of logged-in indicators.
   */
  private async verifyLogin(page: Page): Promise<boolean> {
    // Wait a moment for any redirects to complete
    await page.waitForTimeout(1000).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const url = page.url()
    logger.debug(`Verifying login on URL: ${url}`)

    // Perplexity logged-in URLs typically include /settings, /library, /collections, etc.
    const loggedInPaths = ['/settings', '/library', '/collections', '/account/details']
    if (loggedInPaths.some((path) => url.includes(path))) {
      return true
    }

    // Fallback: look for a user menu element (adjust selector as needed for Perplexity)
    const userMenuExists =
      (await page
        .locator('[data-testid="user-menu"]')
        .count()
        .catch(() => 0)) > 0
    if (userMenuExists) return true

    return false
  }

  /**
   * Saves the current browser context's storage state to disk.
   */
  private async saveAuthState(): Promise<void> {
    if (!this.context) {
      throw new BrowserManager.AuthError('No browser context available to save')
    }
    const storageState = await this.context.storageState()
    writeFileSync(config.authStoragePath, JSON.stringify(storageState, null, 2))
  }

  /**
   * Returns the current page, ensuring it exists.
   */
  private getPage(): Page {
    if (!this.page) {
      throw new BrowserManager.ContextError('Page not initialized')
    }
    return this.page
  }
}
