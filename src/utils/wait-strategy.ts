import type { Page } from '@playwright/test'
import { type Config } from './config.js'

export interface WaitStrategy {
  afterClick(page: Page): Promise<void>
  afterScroll(page: Page): Promise<void>
  forSelector(page: Page, selector: string): Promise<void>
}

class DynamicWaitStrategy implements WaitStrategy {
  private static readonly NETWORK_IDLE_TIMEOUT_MS = 2000
  private static readonly SELECTOR_TIMEOUT_MS = 5000

  async afterClick(page: Page): Promise<void> {
    await page
      .waitForLoadState('networkidle', { timeout: DynamicWaitStrategy.NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => {})
  }

  async afterScroll(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded')
  }

  async forSelector(page: Page, selector: string): Promise<void> {
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

  async forSelector(page: Page, _selector: string): Promise<void> {
    await this.randomPause(page)
  }
}

export const waitStrategy = (config: Config): WaitStrategy => {
  const isDynamicMode = config.waitMode === 'dynamic'
  return isDynamicMode ? new DynamicWaitStrategy() : new StaticWaitStrategy(config.rateLimitMs)
}
