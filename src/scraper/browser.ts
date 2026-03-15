import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'
import { HumanNavigator } from '../utils/human-navigator.js'
import { handleCloudflare } from '../utils/cloudflare.js'

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
      const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)

      if (isSavedAuthValid) {
        await this.launchBrowser(config.headless)
        await this.initializeBrowserContext()

        // --- Session Warming ---
        const page = this.getActivePage()
        logger.info('Warming up browser session to bypass detection...')
        await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded' })
        await handleCloudflare(page)
        await HumanNavigator.simulateBrowsing(page)
        // -----------------------

        await this.navigateToSettingsPage()
        const isLoggedIn = await this.verifyLoginStatus(this.getActivePage())

        if (isLoggedIn) {
          logger.success('Already logged in!')
          return this.getActivePage()
        }

        logger.warn('Saved authentication expired or invalid. Restarting in headful mode for login...')
        await this.close()
      }

      await this.launchBrowser(false)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()
      await this.ensureUserIsAuthenticated()

      if (config.headless !== false) {
        logger.info('Authentication successful. Restarting in headless mode with session warming...')
        await this.close()
        await this.launchBrowser(config.headless)
        await this.initializeBrowserContext()

        // --- Session Warming ---
        const page = this.getActivePage()
        await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded' })
        await handleCloudflare(page)
        await HumanNavigator.simulateBrowsing(page)
        // -----------------------

        await this.navigateToSettingsPage()
      }

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
    this.activePage = null
    this.activeContext = null
    this.browserInstance = null
  }

  private async launchBrowser(headless: boolean | 'new'): Promise<void> {
    try {
      this.browserInstance = await chromium.launch({
        headless: headless === 'new' ? true : headless,
      })
    } catch (_error) {
      throw new BrowserManager.BrowserLaunchError(
        `Failed to launch browser: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async initializeBrowserContext(): Promise<void> {
    if (!this.browserInstance) throw new BrowserManager.ContextError('Browser not initialized')

    const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)
    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    }

    if (isSavedAuthValid) {
      logger.info('Loading saved authentication state...')
      try {
        const storageStateData = JSON.parse(readFileSync(config.authStoragePath, 'utf-8'))
        this.activeContext = await this.browserInstance.newContext({
          ...contextOptions,
          storageState: storageStateData,
        })
      } catch (_error) {
        logger.warn('Failed to load saved auth state, starting fresh.', _error)
        this.activeContext = await this.browserInstance.newContext(contextOptions)
      }
    } else {
      this.activeContext = await this.browserInstance.newContext(contextOptions)
    }

    // Advanced masking script
    await this.activeContext.addInitScript(() => {
      // Overwrite the 'webdriver' property
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Mock hardware properties
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

      // Mock plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
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

    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.activeContext.newPage()
    }

    const perplexitySettingsUrl = 'https://www.perplexity.ai/settings'
    try {
      await this.activePage.goto(perplexitySettingsUrl, {
        timeout: 15000,
        waitUntil: 'domcontentloaded'
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

    const isActuallyLoggedIn = await this.verifyLoginStatus(this.activePage)

    if (isActuallyLoggedIn) {
      logger.success('Already logged in!')
      return
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
