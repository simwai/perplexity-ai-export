import type { Page } from '@playwright/test'
import { type Config } from './config.js'
import { logger } from './logger.js'

export interface WaitStrategy {
  afterClick(page: Page): Promise<void>
  afterScroll(page: Page): Promise<void>
  forSelector(page: Page, selector: string): Promise<void>
}

class DynamicWaitStrategy implements WaitStrategy {
  private static readonly NETWORK_IDLE_TIMEOUT_MS = 2000
  private static readonly SELECTOR_TIMEOUT_MS = 5000

  async afterClick(page: Page): Promise<void> {
    logger.debug('Waiting for network idle after click')
    await page
      .waitForLoadState('networkidle', { timeout: DynamicWaitStrategy.NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => {
        logger.debug('Network idle timeout reached, continuing')
      })
  }

  async afterScroll(page: Page): Promise<void> {
    logger.debug('Waiting for DOM content loaded after scroll')
    await page.waitForLoadState('domcontentloaded')
  }

  async forSelector(page: Page, selector: string): Promise<void> {
    logger.debug('Waiting for selector', { selector })
    await page.waitForSelector(selector, {
      state: 'visible',
      timeout: DynamicWaitStrategy.SELECTOR_TIMEOUT_MS,
    })
  }
}

class StaticWaitStrategy implements WaitStrategy {
  private readonly baseDelayMs: number

  constructor(delayMs: number) {
    this.baseDelayMs = delayMs
  }

  private async randomPause(page: Page, context: string): Promise<void> {
    const jitter = Math.floor(this.baseDelayMs * 0.5 * Math.random())
    const totalWaitTime = this.baseDelayMs + jitter
    logger.debug(`Static wait (${context})`, { totalWaitTime })
    await page.waitForTimeout(totalWaitTime)
  }

  async afterClick(page: Page): Promise<void> {
    await this.randomPause(page, 'afterClick')
  }

  async afterScroll(page: Page): Promise<void> {
    await this.randomPause(page, 'afterScroll')
  }

  async forSelector(page: Page, _selector: string): Promise<void> {
    await this.randomPause(page, 'forSelector')
  }
}

export const waitStrategy = (config: Config): WaitStrategy => {
  const isDynamicMode = config.waitMode === 'dynamic'
  return isDynamicMode ? new DynamicWaitStrategy() : new StaticWaitStrategy(config.rateLimitMs)
}
