import type { Page } from '@playwright/test'
import { type Config } from './config.js'
import { logger } from './logger.js'
import { ok, err, type Result } from 'super-result'
import { createNamedError } from './errors.js'

export const SelectorWaitError = createNamedError('SelectorWaitError')
type SelectorWaitErrorInstance = InstanceType<typeof SelectorWaitError>

export interface WaitStrategy {
  afterClick(page: Page): Promise<void>
  afterScroll(page: Page): Promise<void>
  forSelector(page: Page, selector: string): Promise<Result<void, SelectorWaitErrorInstance>>
}

class DynamicWaitStrategy implements WaitStrategy {
  private static readonly NETWORK_IDLE_TIMEOUT_MS = 2000
  private static readonly SELECTOR_TIMEOUT_MS = 5000

  async afterClick(page: Page): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', {
        timeout: DynamicWaitStrategy.NETWORK_IDLE_TIMEOUT_MS,
      })
    } catch (error) {
      logger.debug('afterClick: networkidle wait timed out; continuing', error)
    }
  }

  async afterScroll(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded')
  }

  async forSelector(
    page: Page,
    selector: string
  ): Promise<Result<void, SelectorWaitErrorInstance>> {
    try {
      await page.waitForSelector(selector, {
        state: 'visible',
        timeout: DynamicWaitStrategy.SELECTOR_TIMEOUT_MS,
      })
      return ok(undefined)
    } catch (error) {
      return err(new SelectorWaitError(error instanceof Error ? error.message : String(error)))
    }
  }
}

class StaticWaitStrategy implements WaitStrategy {
  private readonly baseDelayMs: number

  constructor(delayMs: number) {
    this.baseDelayMs = delayMs
  }

  private async randomPause(page: Page): Promise<void> {
    const jitter = Math.floor(this.baseDelayMs * 0.5 * Math.random())
    const totalWaitTime = this.baseDelayMs + jitter
    await page.waitForTimeout(totalWaitTime)
  }

  async afterClick(page: Page): Promise<void> {
    await this.randomPause(page)
  }

  async afterScroll(page: Page): Promise<void> {
    await this.randomPause(page)
  }

  async forSelector(
    page: Page,
    _selector: string
  ): Promise<Result<void, SelectorWaitErrorInstance>> {
    try {
      await this.randomPause(page)
      return ok(undefined)
    } catch (error) {
      return err(new SelectorWaitError(error instanceof Error ? error.message : String(error)))
    }
  }
}

export const createWaitStrategy = (config: Config): WaitStrategy => {
  const isDynamicMode = config.waitMode === 'dynamic'
  return isDynamicMode ? new DynamicWaitStrategy() : new StaticWaitStrategy(config.rateLimitMs)
}
