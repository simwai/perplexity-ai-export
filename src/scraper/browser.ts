import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { readFileSync, existsSync, statSync } from 'node:fs'
import writeFileAtomic from 'write-file-atomic'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { errorBus } from '../utils/error-bus.js'
import { confirm } from '@inquirer/prompts'
import { logHttpRequest, logHttpResponse } from '../utils/http-logger.js'

export class BrowserManager {
  public browserInstance: Browser | null = null
  private browserContext: BrowserContext | null = null
  private activePage: Page | null = null

  constructor(private readonly applicationConfig: Config) {}

  async launch(): Promise<Page> {
    try {
      const isSavedSessionStillFresh = this.isAuthenticationStateFresh(
        this.applicationConfig.authStoragePath
      )

      if (isSavedSessionStillFresh) {
        await this.initializeBrowserComponents(this.applicationConfig.headless)
        if (await this.isUserAuthenticated()) {
          logger.success('Already logged in!')
          return this.activePage!
        }
        logger.warn('Session invalid. Restarting for login...')
        await this.close()
      }

      const headfulModeEnabled = false
      await this.initializeBrowserComponents(headfulModeEnabled)
      await this.ensureUserIsAuthenticatedInBrowser()

      const shouldRestartInHeadlessMode = this.applicationConfig.headless !== false
      if (shouldRestartInHeadlessMode) {
        logger.info('Auth successful. Restarting in headless...')
        await this.close()
        await this.initializeBrowserComponents(this.applicationConfig.headless)
      }
      return this.activePage!
    } catch (launchError) {
      return errorBus.raiseError('Failed to launch or authenticate browser', launchError)
    }
  }

  async close(): Promise<void> {
    if (this.activePage) await this.activePage.close().catch(() => {})
    if (this.browserContext) await this.browserContext.close().catch(() => {})
    if (this.browserInstance) await this.browserInstance.close().catch(() => {})

    this.activePage = null
    this.browserContext = null
    this.browserInstance = null
  }

  private async initializeBrowserComponents(isHeadlessMode: boolean | 'new') {
    const headlessValueForLaunch = isHeadlessMode === 'new' ? true : isHeadlessMode
    try {
      this.browserInstance = await chromium.launch({ headless: headlessValueForLaunch })

      const isSessionFresh = this.isAuthenticationStateFresh(this.applicationConfig.authStoragePath)
      const contextOptions = isSessionFresh
        ? { storageState: JSON.parse(readFileSync(this.applicationConfig.authStoragePath, 'utf8')) }
        : {}

      this.browserContext = await this.browserInstance.newContext(contextOptions)

      if (this.applicationConfig.debug) {
        this.browserContext.on('request', (request) => {
          const requestUrl = request.url()
          const isRelevantUrl =
            requestUrl.includes('perplexity.ai') && !requestUrl.includes('static')
          if (isRelevantUrl) {
            logHttpRequest(request, true)
          }
        })
        this.browserContext.on('response', (response) => {
          const responseUrl = response.url()
          const isRelevantUrl =
            responseUrl.includes('perplexity.ai') && !responseUrl.includes('static')
          if (isRelevantUrl) {
            logHttpResponse(response, true)
          }
        })
      }

      this.activePage = await this.browserContext.newPage()
      const SETTINGS_PAGE_URL = 'https://www.perplexity.ai/settings'
      await this.activePage.goto(SETTINGS_PAGE_URL, { timeout: 15000 }).catch(() => {})
    } catch (initializationError) {
      errorBus.raiseError('Browser initialization failed', initializationError)
    }
  }

  private isAuthenticationStateFresh(filePath: string): boolean {
    if (!existsSync(filePath)) return false

    const ONE_DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
    const fileLastModifiedTimeMilliseconds = statSync(filePath).mtimeMs
    const currentTimestampMilliseconds = Date.now()
    const fileAgeMilliseconds = currentTimestampMilliseconds - fileLastModifiedTimeMilliseconds

    return fileAgeMilliseconds < ONE_DAY_IN_MILLISECONDS
  }

  private async isUserAuthenticated(): Promise<boolean> {
    if (!this.activePage) return false
    try {
      const sessionData = await this.activePage.evaluate(async () => {
        try {
          const authSessionResponse = await fetch('/api/auth/session')
          return await authSessionResponse.json()
        } catch {
          return {}
        }
      })
      return !!(sessionData.user || sessionData.expires)
    } catch {
      return false
    }
  }

  private async ensureUserIsAuthenticatedInBrowser() {
    if (await this.isUserAuthenticated()) return

    logger.info('Please log in manually...')
    await confirm({ message: 'Press Enter when logged in and on settings page' })

    const SETTINGS_PAGE_URL = 'https://www.perplexity.ai/settings'
    await this.activePage!.goto(SETTINGS_PAGE_URL, { waitUntil: 'networkidle' })

    if (!(await this.isUserAuthenticated())) {
      errorBus.raiseError('Login verification failed')
    }

    await this.persistAuthenticationStateToDisk()
    logger.success('Auth saved!')
  }

  private async persistAuthenticationStateToDisk() {
    if (!this.browserContext) return
    const currentStorageState = await this.browserContext.storageState()

    if (currentStorageState.cookies.length > 0) {
      const serializedStateJson = JSON.stringify(currentStorageState, null, 2)
      await (writeFileAtomic as any)(this.applicationConfig.authStoragePath, serializedStateJson)
    }
  }
}
