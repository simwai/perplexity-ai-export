import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'
import { logHttpRequest, logHttpResponse } from '../utils/http-logger.js'

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

  constructor(private readonly config: Config) {}

  async launch(): Promise<Page> {
    try {
      const isSavedAuthValid = this.isSavedAuthenticationFresh(this.config.authStoragePath)

      if (isSavedAuthValid) {
        await this.launchBrowser(this.config.headless)
        await this.initializeBrowserContext()
        await this.navigateToSettingsPage()

        const isLoggedIn = await this.verifyLoginStatus(this.getActivePage())
        if (isLoggedIn) {
          logger.success('Already logged in!')
          return this.getActivePage()
        }

        logger.warn(
          'Saved authentication expired or invalid. Restarting in headful mode for login...'
        )
        await this.close()
      }

      // Need manual login: launch headful
      await this.launchBrowser(false)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()
      await this.ensureUserIsAuthenticated()

      const shouldRestartInHeadless = this.config.headless !== false
      if (shouldRestartInHeadless) {
        logger.info('Authentication successful. Restarting in headless mode...')
        await this.close()
        await this.launchBrowser(this.config.headless)
        await this.initializeBrowserContext()
        await this.navigateToSettingsPage()
      }

      return this.getActivePage()
    } catch (error) {
      if (error instanceof Error) throw error
      throw new BrowserManager.BrowserLaunchError(`Unexpected error: ${String(error)}`)
    }
  }

  async close(): Promise<void> {
    if (this.activePage) {
      await this.activePage.close().catch(() => {})
    }
    if (this.activeContext) {
      await this.activeContext.close().catch(() => {})
    }
    if (this.browserInstance) {
      await this.browserInstance.close().catch(() => {})
    }
    this.activePage = null
    this.activeContext = null
    this.browserInstance = null
  }

  private async launchBrowser(headless: boolean | 'new'): Promise<void> {
    try {
      const actualHeadlessValue = headless === 'new' ? true : headless
      this.browserInstance = await chromium.launch({
        headless: actualHeadlessValue,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new BrowserManager.BrowserLaunchError(`Failed to launch browser: ${errorMessage}`)
    }
  }

  private async initializeBrowserContext(): Promise<void> {
    if (!this.browserInstance) {
      throw new BrowserManager.ContextError('Browser not initialized')
    }

    const isSavedAuthValid = this.isSavedAuthenticationFresh(this.config.authStoragePath)

    if (isSavedAuthValid) {
      logger.info('Loading saved authentication state...')
      try {
        const storageStateJson = readFileSync(this.config.authStoragePath, 'utf-8')
        const storageStateData = JSON.parse(storageStateJson)
        this.activeContext = await this.browserInstance.newContext({
          storageState: storageStateData,
        })
      } catch (error) {
        logger.warn('Failed to load saved auth state, starting fresh.', error)
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      const authFileExists = existsSync(this.config.authStoragePath)
      if (authFileExists) {
        logger.info('Saved authentication is older than 1 day, discarding.')
      }
      this.activeContext = await this.browserInstance.newContext()
    }

    if (this.config.debugMode && this.activeContext) {
      this.activeContext.on('request', (req) => logHttpRequest(req))
      this.activeContext.on('response', (res) => logHttpResponse(res))
    }
  }

  private isSavedAuthenticationFresh(filePath: string): boolean {
    const fileExists = existsSync(filePath)
    if (!fileExists) return false

    try {
      const fileStats = statSync(filePath)
      const fileAgeMs = Date.now() - fileStats.mtimeMs
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
      return fileAgeMs < TWENTY_FOUR_HOURS_MS
    } catch (_error) {
      return false
    }
  }

  private async navigateToSettingsPage(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.NavigationError('No browser context available')
    }

    this.activePage = await this.activeContext.newPage()
    const SETTINGS_URL = 'https://www.perplexity.ai/settings'
    const NAVIGATION_TIMEOUT_MS = 3000

    try {
      await this.activePage.goto(SETTINGS_URL, {
        timeout: NAVIGATION_TIMEOUT_MS,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new BrowserManager.NavigationError(`Failed to navigate to settings: ${errorMessage}`)
    }
  }

  private async ensureUserIsAuthenticated(): Promise<void> {
    if (!this.activePage) {
      throw new BrowserManager.AuthError('Page not initialized')
    }

    const isLoggedIn = await this.verifyLoginStatus(this.activePage)
    if (isLoggedIn) {
      logger.success('Already logged in!')
      return
    }

    logger.info('Please log in manually in the browser window...')
    await confirm({
      message: 'Press Enter when you are logged in and on the settings page',
      default: true,
    })

    const SETTINGS_URL = 'https://www.perplexity.ai/settings'
    await this.activePage.goto(SETTINGS_URL, {
      waitUntil: 'networkidle',
    })

    const isLoginConfirmed = await this.verifyLoginStatus(this.activePage)
    if (!isLoginConfirmed) {
      const currentUrl = this.activePage.url()
      throw new BrowserManager.AuthError(`Login verification failed. Current URL: ${currentUrl}`)
    }

    await this.persistAuthenticationState()
    logger.success('Authentication state saved!')
  }

  private async verifyLoginStatus(page: Page): Promise<boolean> {
    const INTERMEDIATE_DELAY_MS = 1000
    const NETWORK_IDLE_TIMEOUT_MS = 5000

    await page.waitForTimeout(INTERMEDIATE_DELAY_MS).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {})

    const currentUrl = page.url()
    const AUTHENTICATED_PATHS = ['/settings', '/library', '/collections', '/account/details']
    const isUrlAuthenticated = AUTHENTICATED_PATHS.some((path) => currentUrl.includes(path))

    if (isUrlAuthenticated) {
      return true
    }

    const userMenuCount = await page
      .locator('[data-testid="user-menu"]')
      .count()
      .catch(() => 0)

    return userMenuCount > 0
  }

  private async persistAuthenticationState(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.AuthError('No browser context available to save')
    }
    const currentStorageState = await this.activeContext.storageState()
    const serializedState = JSON.stringify(currentStorageState, null, 2)
    writeFileSync(this.config.authStoragePath, serializedState)
  }

  private getActivePage(): Page {
    if (!this.activePage) {
      throw new BrowserManager.ContextError('Page not initialized')
    }
    return this.activePage
  }
}
