import { type Browser, type BrowserContext, type Page } from '@playwright/test'
// `playwright-extra` is a drop-in wrapper around Playwright's `chromium` that
// lets us register puppeteer-extra plugins. The Stealth plugin patches ~17
// fingerprints Cloudflare and similar bot-management vendors use to detect
// headless browsers (navigator.webdriver, plugins array, WebGL renderer,
// chrome.runtime, languages, hardwareConcurrency, etc.).
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { confirm } from '@inquirer/prompts'

// Register the stealth plugin exactly once at module load. Re-registering on
// every launch is a no-op but spams logs.
let stealthPluginRegistered = false
function ensureStealthPluginRegistered(): void {
  if (stealthPluginRegistered) return
  try {
    chromium.use(StealthPlugin())
    stealthPluginRegistered = true
    logger.debug('browser: stealth plugin registered with playwright-extra chromium')
  } catch (err) {
    logger.warn(
      `browser: failed to register stealth plugin (${
        err instanceof Error ? err.message : String(err)
      }) — continuing without stealth`
    )
    // Mark as registered anyway so we don't retry forever.
    stealthPluginRegistered = true
  }
}

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
      logger.debug(
        `launch: authStoragePath=${config.authStoragePath} configHeadless=${String(
          config.headless
        )} isSavedAuthValid=${isSavedAuthValid}`
      )

      if (isSavedAuthValid) {
        // Browser visibility for the saved-auth (auto-login) path.
        //
        // Perplexity sits behind Cloudflare Turnstile, which fingerprints
        // headless *rendering* — not just navigator.webdriver — and 403s
        // headless requests even with a perfect cookie jar AND the stealth
        // plugin. The debug.log trace proved it: the exact same cookies that
        // return 403 headless returned 200 headful a moment later. So when the
        // user has opted into a real browser (HEADLESS=false) we must honor it
        // here too — otherwise the auth probe (and later every worker) gets
        // challenged. Only run headless when explicitly requested (HEADLESS=
        // true or 'new').
        const headlessForAutoLogin: boolean | 'new' = config.headless
        logger.debug(
          `launch[saved-auth-path]: launching headless=${String(headlessForAutoLogin)} ` +
            `(config.headless=${String(config.headless)})`
        )
        await this.launchBrowser(headlessForAutoLogin)
        await this.initializeBrowserContext()
        await this.navigateToSettingsPage()
        const isLoggedIn = await this.verifyLoginStatus(this.getActivePage())
        logger.debug(`launch[saved-auth-path]: verifyLoginStatus=${isLoggedIn}`)

        if (isLoggedIn) {
          logger.success('Already logged in!')
          return this.getActivePage()
        }

        logger.warn(
          'Saved authentication expired or invalid. Restarting in headful mode for login...'
        )
        await this.close()
      }

      // Need login: launch headful
      logger.debug('launch[manual-login-path]: launching headful for sign-in')
      await this.launchBrowser(false)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()
      await this.ensureUserIsAuthenticated()

      // Browser visibility for the extraction phase after a manual login.
      //
      // HEADLESS=false means "use a real, visible browser the whole way" — the
      // only thing that reliably gets past Cloudflare Turnstile (see the
      // saved-auth-path note above). In that case keep the headful browser the
      // user just signed into instead of tearing it down and relaunching
      // headless (which would immediately get 403'd). Only when the user
      // explicitly opted into headless do we restart in headless/'new'.
      if (config.headless === false) {
        logger.info(
          'Authentication successful. Keeping the visible browser open for extraction ' +
            '(HEADLESS=false — required to satisfy Cloudflare).'
        )
        logger.debug('launch[manual-login-path]: keeping headful browser for extraction')
        return this.getActivePage()
      }

      const postLoginHeadlessMode: boolean | 'new' = config.headless === 'new' ? 'new' : true
      logger.info('Authentication successful. Restarting in headless mode for extraction...')
      logger.debug(
        `launch[manual-login-path]: post-login restart headless=${String(postLoginHeadlessMode)}`
      )
      await this.close()
      await this.launchBrowser(postLoginHeadlessMode)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()

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
    ensureStealthPluginRegistered()
    try {
      // Drive the installed Google Chrome (`channel: 'chrome'`) instead of
      // Playwright's bundled Chromium build, and route through `playwright-
      // extra` so the stealth plugin can patch headless fingerprints.
      // Together these get us past Perplexity's Cloudflare bot-management
      // even in fully-headless extraction. Falls back to bundled Chromium
      // (still stealth-wrapped) if Chrome isn't installed.
      const launchOptions = {
        headless: headless === 'new' ? true : headless,
        args: ['--disable-blink-features=AutomationControlled'],
      }

      try {
        this.browserInstance = await chromium.launch({
          ...launchOptions,
          channel: 'chrome',
        })
        logger.debug(
          'launchBrowser: using channel=chrome (installed Google Chrome) + stealth plugin'
        )
      } catch (chromeChannelError) {
        logger.warn(
          `launchBrowser: channel:'chrome' failed (${
            chromeChannelError instanceof Error
              ? chromeChannelError.message
              : String(chromeChannelError)
          }) — falling back to bundled Chromium`
        )
        this.browserInstance = await chromium.launch(launchOptions)
        logger.debug('launchBrowser: using bundled Chromium (fallback) + stealth plugin')
      }
    } catch (_error) {
      throw new BrowserManager.BrowserLaunchError(
        `Failed to launch browser: ${_error instanceof Error ? _error.message : String(_error)}`
      )
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
        this.logStorageStateSummary(storageStateData, 'initializeBrowserContext: loaded')
      } catch (_error) {
        logger.warn('Failed to load saved auth state, starting fresh.', _error)
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      if (existsSync(config.authStoragePath)) {
        logger.info('Saved authentication is older than 1 day, discarding.')
      }
      logger.debug('initializeBrowserContext: starting with empty context (no saved auth)')
      this.activeContext = await this.browserInstance.newContext()
    }
  }

  // Summarize a Playwright storageState shape without leaking cookie values.
  // Logs only counts and metadata names so debug.log stays safe to share.
  private logStorageStateSummary(storageStateData: any, label: string): void {
    try {
      const cookies = Array.isArray(storageStateData?.cookies) ? storageStateData.cookies : []
      const cookieDomains = Array.from(new Set(cookies.map((c: any) => String(c?.domain ?? '?'))))
      const cookieNames = cookies.map((c: any) => String(c?.name ?? '?'))
      const httpOnlyCount = cookies.filter((c: any) => c?.httpOnly === true).length
      const origins = Array.isArray(storageStateData?.origins) ? storageStateData.origins : []
      logger.debug(
        `${label}: cookieCount=${cookies.length} httpOnlyCount=${httpOnlyCount} ` +
          `domains=${JSON.stringify(cookieDomains)} ` +
          `cookieNames=${JSON.stringify(cookieNames)} ` +
          `originCount=${origins.length}`
      )
    } catch (err) {
      logger.debug(
        `${label}: failed to summarize storageState: ${err instanceof Error ? err.message : String(err)}`
      )
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
        timeout: 15_000,
        waitUntil: 'domcontentloaded',
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

    logger.info('Please log in manually in the browser window — take your time.')
    logger.info(
      'When you are signed in, switch back here and press Enter. ' +
        'If verification fails (e.g. OAuth still redirecting), you will be re-prompted; ' +
        'the browser stays open. Use Ctrl+C only if you want to give up entirely.'
    )

    const maxVerificationAttempts = 5
    for (let attempt = 1; attempt <= maxVerificationAttempts; attempt++) {
      await confirm({
        message:
          attempt === 1
            ? 'Press Enter once you have completed sign-in'
            : `Press Enter to re-check (attempt ${attempt}/${maxVerificationAttempts})`,
        default: true,
      })

      const verified = await this.gentleReverifyLogin().catch((err) => {
        logger.warn(
          `Verification attempt failed transiently: ${err instanceof Error ? err.message : String(err)}`
        )
        return false
      })

      if (verified) {
        await this.persistAuthenticationState()
        logger.success('Authentication state saved!')
        return
      }

      logger.warn(
        "Still don't see an authenticated session. " +
          'Make sure your browser tab is signed in to https://www.perplexity.ai/ (any page on that domain), then try again.'
      )
    }

    throw new BrowserManager.AuthError(
      `Gave up after ${maxVerificationAttempts} unsuccessful verification attempts. ` +
        `Current URL: ${this.activePage.url()}`
    )
  }

  // Re-verify login without rudely yanking the user's tab away from an in-progress
  // OAuth flow. Only re-navigate to /settings if the user is somewhere off-domain
  // or on the public login/signup wall; otherwise just let whatever Perplexity tab
  // they ended up on settle, and probe that.
  private async gentleReverifyLogin(): Promise<boolean> {
    if (!this.activePage) return false

    const currentUrl = this.activePage.url()
    const isOnPerplexity = /^https?:\/\/(www\.)?perplexity\.ai\//.test(currentUrl)
    const looksLikeAuthWall = /\/(login|signin|signup)(\?|$|\/)/i.test(currentUrl)

    if (!isOnPerplexity || looksLikeAuthWall) {
      await this.activePage
        .goto('https://www.perplexity.ai/settings', {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        })
        .catch((err) => {
          logger.warn(
            `Could not navigate to /settings for verification: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        })
    } else {
      await this.activePage.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    }

    return this.verifyLoginStatus(this.activePage)
  }

  private async verifyLoginStatus(page: Page): Promise<boolean> {
    await page.waitForTimeout(1000).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const currentUrlBeforeProbe = page.url()
    logger.debug(`verifyLoginStatus: probing from url=${currentUrlBeforeProbe}`)

    const apiProbeOutcome = await this.probeAuthenticationViaApi(page)
    logger.debug(`verifyLoginStatus: api probe outcome=${apiProbeOutcome}`)
    if (apiProbeOutcome !== 'inconclusive') {
      return apiProbeOutcome === 'authenticated'
    }

    // Defensive fallback: if the API probe itself failed (network error, etc.),
    // fall back to a DOM signal rather than guessing from the URL.
    const userMenuElementCount = await page
      .locator('[data-testid="user-menu"]')
      .count()
      .catch(() => 0)
    logger.debug(`verifyLoginStatus: DOM fallback userMenuElementCount=${userMenuElementCount}`)

    return userMenuElementCount > 0
  }

  private async probeAuthenticationViaApi(
    page: Page
  ): Promise<'authenticated' | 'unauthenticated' | 'inconclusive'> {
    try {
      const probeResult = await page.evaluate(async () => {
        try {
          const response = await fetch(
            '/rest/thread/list_ask_threads?version=2.18&source=default',
            {
              method: 'POST',
              credentials: 'include',
              redirect: 'manual',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                limit: 1,
                ascending: false,
                offset: 0,
                search_term: '',
              }),
            }
          )

          let bodyIsArray = false
          let bodyLength = 0
          try {
            const parsed = await response.json()
            if (Array.isArray(parsed)) {
              bodyIsArray = true
              bodyLength = parsed.length
            }
          } catch {
            bodyIsArray = false
          }

          return {
            status: response.status,
            type: response.type,
            redirected: response.redirected,
            url: response.url,
            bodyIsArray,
            bodyLength,
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      })

      if ('error' in probeResult) {
        logger.debug(`probeAuthenticationViaApi: fetch threw error=${probeResult.error}`)
        return 'inconclusive'
      }
      logger.debug(
        `probeAuthenticationViaApi: status=${probeResult.status} type=${probeResult.type} ` +
          `redirected=${probeResult.redirected} url=${probeResult.url} ` +
          `bodyIsArray=${probeResult.bodyIsArray} bodyLength=${probeResult.bodyLength}`
      )

      // Manual redirects (e.g. to a login URL) surface as opaqueredirect / status 0.
      if (probeResult.type === 'opaqueredirect' || probeResult.status === 0) {
        return 'unauthenticated'
      }

      if (probeResult.status === 401 || probeResult.status === 403) {
        return 'unauthenticated'
      }

      if (probeResult.redirected && /login|signin|signup/i.test(probeResult.url)) {
        return 'unauthenticated'
      }

      if (probeResult.status === 200 && probeResult.bodyIsArray) {
        // A non-empty array is a strong positive signal: an unauthenticated
        // caller can never see another user's threads.
        if (probeResult.bodyLength > 0) {
          return 'authenticated'
        }
        // 200 + empty array is ambiguous: either a brand-new user with zero
        // threads, or (much more common) an unauthenticated session that
        // Perplexity quietly answers with []. Defer to the DOM fallback
        // (`[data-testid="user-menu"]` is rendered for real sessions and
        // absent on the login wall).
        return 'inconclusive'
      }

      // 2xx but non-array body is suspicious (Perplexity wraps an HTML login
      // page or error envelope here); treat as unauthenticated.
      if (probeResult.status >= 200 && probeResult.status < 300) {
        return 'unauthenticated'
      }

      return 'inconclusive'
    } catch (_error) {
      return 'inconclusive'
    }
  }

  private async persistAuthenticationState(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.AuthError('No browser context available to save')
    }
    const currentStorageState = await this.activeContext.storageState()
    writeFileSync(config.authStoragePath, JSON.stringify(currentStorageState, null, 2))
    this.logStorageStateSummary(currentStorageState, 'persistAuthenticationState: saved')
  }

  private getActivePage(): Page {
    if (!this.activePage) {
      throw new BrowserManager.ContextError('Page not initialized')
    }
    return this.activePage
  }
}
