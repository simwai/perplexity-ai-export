import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createNamedError } from '../utils/errors.js'
import { ok, err, type Result } from 'super-result'
import { logHttpRequest, logHttpResponse } from '../utils/http-logger.js'
import { createWaitStrategy } from '../utils/wait-strategy.js'
import { z } from 'zod'
import { ApiDiagnosticsWriter } from '../utils/api-diagnostics.js'

const SETTINGS_URL = 'https://www.perplexity.ai/settings'
const NAVIGATION_TIMEOUT_MS = 15_000
const CLOUDFLARE_CHALLENGE_PATTERN = /cdn-cgi\/challenge|cf-challenge|cloudflare/i

const PlaywrightStorageStateSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(['None', 'Strict', 'Lax']),
    })
  ),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    })
  ),
})

const AuthSessionSchema = z.object({
  user: z.unknown().optional(),
  expires: z.unknown().optional(),
  email: z.unknown().optional(),
})

export class BrowserManager {
  static readonly BrowserLaunchError = createNamedError('BrowserLaunchError')
  static readonly AuthError = createNamedError('AuthError')
  static readonly ContextError = createNamedError('ContextError')
  static readonly NavigationError = createNamedError('NavigationError')

  private readonly config: Config
  private browserInstance: Browser | null = null
  private activeContext: BrowserContext | null = null
  private activePage: Page | null = null
  private readonly waitStrategy: ReturnType<typeof createWaitStrategy>
  private readonly diagnosticsWriter: ApiDiagnosticsWriter

  constructor(config: Config) {
    this.config = config
    this.waitStrategy = createWaitStrategy(config)
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
  }

  async launch(): Promise<
    Result<
      Page,
      | BrowserLaunchErrorInstance
      | AuthErrorInstance
      | ContextErrorInstance
      | NavigationErrorInstance
    >
  > {
    const authPath = this.config.authStoragePath
    const authExists = existsSync(authPath)
    const shouldTrySavedState = authExists

    if (shouldTrySavedState) {
      const launchResult = await this.launchBrowser(this.config.headless)
      if (!launchResult.ok) return err(launchResult.error)
      const contextResult = await this.newContextWithSavedState()
      if (!contextResult.ok) return err(contextResult.error)
      const navResult = await this.waitForSettingsPageLoaded()
      if (!navResult.ok) return err(navResult.error)

      const pageResult = this.getActivePage()
      if (!pageResult.ok) return err(pageResult.error)
      const loginResult = await this.verifyLoginStatus(pageResult.value)
      if (!loginResult.ok) return err(loginResult.error)
      const isLoggedIn = loginResult.value
      if (isLoggedIn) {
        logger.info('Already logged in!')
        return pageResult
      }

      logger.warn(
        'Saved authentication expired or invalid. Restarting in headful mode for login...'
      )
      await this.close()
    }

    // Need manual login: launch headful
    const launchResult2 = await this.launchBrowser(false)
    if (!launchResult2.ok) return err(launchResult2.error)
    const contextResult2 = await this.newFreshContext()
    if (!contextResult2.ok) return err(contextResult2.error)
    const navResult2 = await this.waitForSettingsPageLoaded()
    if (!navResult2.ok) return err(navResult2.error)
    const authResult = await this.ensureUserIsAuthenticated()
    if (!authResult.ok) return err(authResult.error)

    const shouldRestartInHeadless = this.config.headless !== false
    if (shouldRestartInHeadless) {
      logger.info('Authentication successful. Restarting in headless mode...')
      await this.close()
      const launchResult3 = await this.launchBrowser(this.config.headless)
      if (!launchResult3.ok) return err(launchResult3.error)
      const contextResult3 = await this.newContextWithSavedState()
      if (!contextResult3.ok) return err(contextResult3.error)
      const navResult3 = await this.waitForSettingsPageLoaded()
      if (!navResult3.ok) return err(navResult3.error)
    }

    const finalPageResult = this.getActivePage()
    if (!finalPageResult.ok) return err(finalPageResult.error)
    return finalPageResult
  }

  async close(): Promise<void> {
    try {
      if (this.activePage) {
        await this.activePage.close()
      }
    } catch (err) {
      logger.debug('close: activePage.close failed', errorMessageOf(err))
    } finally {
      this.activePage = null
    }

    try {
      if (this.activeContext) {
        await this.activeContext.close()
      }
    } catch (err) {
      logger.debug('close: activeContext.close failed', errorMessageOf(err))
    } finally {
      this.activeContext = null
    }

    try {
      if (this.browserInstance) {
        await this.browserInstance.close()
      }
    } catch (err) {
      logger.debug('close: browserInstance.close failed', errorMessageOf(err))
    } finally {
      this.browserInstance = null
    }
  }

  private async launchBrowser(
    headless: boolean | 'new'
  ): Promise<Result<void, BrowserLaunchErrorInstance>> {
    try {
      const actualHeadlessValue = headless === 'new' ? true : headless
      this.browserInstance = await chromium.launch({
        headless: actualHeadlessValue,
        args: ['--disable-blink-features=AutomationControlled'],
      })
      return ok(undefined)
    } catch (error) {
      return err(
        new BrowserManager.BrowserLaunchError(
          error instanceof Error ? error.message : String(error)
        )
      )
    }
  }

  private async newFreshContext(): Promise<Result<void, ContextErrorInstance>> {
    if (!this.browserInstance) {
      return err(new BrowserManager.ContextError('Browser not initialized'))
    }
    this.activeContext = await this.browserInstance.newContext()
    return ok(undefined)
  }

  private async newContextWithSavedState(): Promise<Result<void, ContextErrorInstance>> {
    if (!this.browserInstance) {
      return err(new BrowserManager.ContextError('Browser not initialized'))
    }
    if (existsSync(this.config.authStoragePath)) {
      logger.info('Loading saved authentication state...')
      let storageResult: { ok: boolean; value?: unknown; error?: Error }
      try {
        const storageStateJson = readFileSync(this.config.authStoragePath, 'utf-8')
        storageResult = { ok: true, value: JSON.parse(storageStateJson) }
      } catch (error) {
        return err(
          new BrowserManager.ContextError(error instanceof Error ? error.message : String(error))
        )
      }
      if (storageResult.ok && storageResult.value !== undefined) {
        const validated = PlaywrightStorageStateSchema.safeParse(storageResult.value)
        if (validated.success) {
          this.activeContext = await this.browserInstance.newContext({
            storageState: validated.data,
          })
        } else {
          const paths = validated.error.issues.map((issue) => issue.path.join('.'))
          try {
            await this.diagnosticsWriter.writeFailure({
              url: this.config.authStoragePath,
              errorType: 'zod_error',
              zodErrorPaths: paths,
            })
          } catch {
            // best-effort diagnostics write
          }
          logger.warn(`Failed to validate saved auth state, starting fresh: ${validated.error}`)
          this.activeContext = await this.browserInstance.newContext()
        }
      } else {
        logger.warn(
          `Failed to load saved auth state, starting fresh: ${storageResult.error ? errorMessageOf(storageResult.error) : 'unknown error'}`
        )
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      this.activeContext = await this.browserInstance.newContext()
    }

    if (this.config.debug && this.activeContext) {
      this.activeContext.on('request', (req) => {
        const requestUrl = req.url()
        const isRelevantUrl =
          (requestUrl.includes('perplexity.ai/rest') || requestUrl.includes('perplexity.ai/api')) &&
          !requestUrl.includes('static')
        if (isRelevantUrl) logHttpRequest(req, this.config.debug)
      })
      this.activeContext.on('response', (res) => {
        const responseUrl = res.url()
        const isRelevantUrl =
          (responseUrl.includes('perplexity.ai/rest') ||
            responseUrl.includes('perplexity.ai/api')) &&
          !responseUrl.includes('static')
        if (isRelevantUrl) logHttpResponse(res, this.config.debug)
      })
    }
    return ok(undefined)
  }

  private async waitForSettingsPageLoaded(): Promise<Result<void, NavigationErrorInstance>> {
    if (!this.activeContext) {
      return err(new BrowserManager.NavigationError('No browser context available'))
    }

    this.activePage = await this.activeContext.newPage()

    try {
      if (!this.activePage) {
        return err(
          new BrowserManager.NavigationError(
            '[waitForSettingsPageLoaded] Failed to create new active page'
          )
        )
      }
      await this.activePage.goto(SETTINGS_URL, {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      })

      await this.activePage.waitForFunction(
        () => {
          const url = new URL(window.location.href)
          return url.hash.startsWith('#settings') || url.pathname !== '/settings'
        },
        undefined,
        { timeout: NAVIGATION_TIMEOUT_MS }
      )

      const selectorResult = await this.waitStrategy.forSelector(
        this.activePage,
        '[name="account.profile.username"]'
      )
      if (!selectorResult.ok) {
        return err(selectorResult.error as NavigationErrorInstance)
      }
      return ok(undefined)
    } catch (error) {
      return err(
        new BrowserManager.NavigationError(error instanceof Error ? error.message : String(error))
      )
    }
  }

  private async ensureUserIsAuthenticated(): Promise<Result<void, AuthErrorInstance>> {
    if (!this.activePage) {
      return err(new BrowserManager.AuthError('Page not initialized'))
    }

    while (true) {
      const loginResult = await this.verifyLoginStatus(this.activePage)
      if (!loginResult.ok) return err(loginResult.error)
      const isLoggedIn = loginResult.value
      if (isLoggedIn) {
        logger.info('Already logged in!')
        return ok(undefined)
      }

      logger.info('Please log in manually in the browser window...')
      await confirm({
        message: 'Press Enter when you are logged in and on the settings page',
        default: true,
      })

      await this.waitStrategy.afterClick(this.activePage)

      // Check for Cloudflare challenge before verifying auth
      const cloudflareDetected = await this.isCloudflareChallenge(this.activePage)
      if (cloudflareDetected) {
        return err(
          new BrowserManager.AuthError(
            'Cloudflare challenge detected. Please complete the CAPTCHA/verification, then try again.'
          )
        )
      }

      const hashResult = await this.waitForHashRoutingToSettle(this.activePage)
      if (!hashResult.ok) {
        logger.debug('Hash routing not yet settled; proceeding to verify')
      }

      const loginVerificationResult = await this.verifyLoginStatus(this.activePage)
      if (!loginVerificationResult.ok) {
        logger.debug('Login verification failed; proceeding without confirmation')
      } else if (loginVerificationResult.value) {
        await this.persistAuthenticationState()
        logger.info('Authentication state saved!')
        return ok(undefined)
      }

      const currentUrl = this.activePage.url()
      logger.warn(`Login verification failed. Current URL: ${currentUrl}`)

      const retry = await confirm({
        message: 'Login verification failed. Do you want to try again?',
        default: true,
      })

      if (!retry) {
        return err(
          new BrowserManager.AuthError(`Login verification failed. Current URL: ${currentUrl}`)
        )
      }
    }
  }

  private async isCloudflareChallenge(page: Page): Promise<boolean> {
    const currentUrl = page.url()
    if (CLOUDFLARE_CHALLENGE_PATTERN.test(currentUrl)) return true

    try {
      const result = await page.evaluate(async () => {
        try {
          const body = document.body.innerText
          return (
            body.includes('Checking your browser') ||
            body.includes('Verifying your identity') ||
            body.includes('One moment') ||
            body.includes('cf-turnstile') ||
            body.includes('cloudflare')
          )
        } catch {
          return false
        }
      })
      return result === true
    } catch {
      return false
    }
  }

  private async waitForHashRoutingToSettle(page: Page): Promise<Result<void, AuthErrorInstance>> {
    try {
      if (!page) {
        return err(new BrowserManager.AuthError('Page not initialized'))
      }
      await page.waitForFunction(
        () => {
          const url = new URL(window.location.href)
          return url.hash.startsWith('#settings') || url.pathname !== '/settings'
        },
        undefined,
        { timeout: NAVIGATION_TIMEOUT_MS }
      )
      return ok(undefined)
    } catch (error) {
      return err(
        new BrowserManager.AuthError(error instanceof Error ? error.message : String(error))
      )
    }
  }

  private async verifyLoginStatus(page: Page): Promise<Result<boolean, AuthErrorInstance>> {
    try {
      await page.waitForTimeout(1000)
      await page.waitForLoadState('domcontentloaded')

      const result = await page.evaluate(async () => {
        try {
          const res = await fetch('/api/auth/session', {
            method: 'GET',
            credentials: 'include',
          })
          const text = await res.text()
          return { body: text }
        } catch (e) {
          return { body: '' }
        }
      })

      const trimmed = result.body.trim()
      if (!trimmed) {
        return ok(false)
      }

      try {
        const parsed = AuthSessionSchema.safeParse(JSON.parse(trimmed))
        if (!parsed.success) {
          const paths = parsed.error.issues.map((issue) => issue.path.join('.'))
          await this.diagnosticsWriter.writeFailure({
            url: '/api/auth/session',
            errorType: 'zod_error',
            zodErrorPaths: paths,
          })
          return ok(false)
        }
        const hasUser = Boolean(parsed.data.user)
        const hasExpires = Boolean(parsed.data.expires)
        const hasEmail = Boolean(parsed.data.email)
        return ok(hasUser || hasExpires || hasEmail)
      } catch {
        return ok(false)
      }
    } catch (error) {
      return err(
        new BrowserManager.AuthError(error instanceof Error ? error.message : String(error))
      )
    }
  }

  private async persistAuthenticationState(): Promise<Result<void, AuthErrorInstance>> {
    if (!this.activeContext) {
      return err(new BrowserManager.AuthError('No browser context available to save'))
    }
    const currentStorageState = await this.activeContext.storageState()
    logger.debug(
      `Persisting auth state: ${currentStorageState.cookies.length} cookies, ${currentStorageState.origins.length} origins`
    )

    if (currentStorageState.cookies.length === 0) {
      logger.warn(
        'persistAuthenticationState: no cookies found — skipping write to avoid overwriting valid state'
      )
      return ok(undefined)
    }

    const serializedState = JSON.stringify(currentStorageState, null, 2)
    const tmpPath = `${this.config.authStoragePath}.tmp`

    try {
      writeFileSync(tmpPath, serializedState)
    } catch (error) {
      return err(
        new BrowserManager.AuthError(error instanceof Error ? error.message : String(error))
      )
    }

    const fs = await import('node:fs')
    try {
      fs.renameSync(tmpPath, this.config.authStoragePath)
    } catch (error) {
      return err(
        new BrowserManager.AuthError(error instanceof Error ? error.message : String(error))
      )
    }

    return ok(undefined)
  }

  private getActivePage(): Result<Page, ContextErrorInstance> {
    if (!this.activePage) {
      return err(new BrowserManager.ContextError('Page not initialized'))
    }
    return ok(this.activePage)
  }

  getBrowserInstance(): Browser | null {
    return this.browserInstance
  }
}

type BrowserLaunchErrorInstance = InstanceType<typeof BrowserManager.BrowserLaunchError>
type AuthErrorInstance = InstanceType<typeof BrowserManager.AuthError>
type ContextErrorInstance = InstanceType<typeof BrowserManager.ContextError>
type NavigationErrorInstance = InstanceType<typeof BrowserManager.NavigationError>
