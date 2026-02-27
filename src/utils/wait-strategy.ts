import type { Page } from '@playwright/test'
import { config } from './config.js'

export interface WaitStrategy {
  afterClick(page: Page): Promise<void>
  afterScroll(page: Page): Promise<void>
  forSelector(page: Page, selector: string): Promise<void>
}

class DynamicWaitStrategy implements WaitStrategy {
  async afterClick(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {})
  }

  async afterScroll(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded')
  }

  async forSelector(page: Page, selector: string): Promise<void> {
    await page.waitForSelector(selector, { state: 'visible', timeout: 5000 })
  }
}

class StaticWaitStrategy implements WaitStrategy {
  private readonly delayMs: number

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  private async randomPause(page: Page): Promise<void> {
    const jitter = Math.floor(this.delayMs * 0.5 * Math.random())
    await page.waitForTimeout(this.delayMs + jitter)
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

export const waitStrategy: WaitStrategy =
  config.waitMode === 'dynamic'
    ? new DynamicWaitStrategy()
    : new StaticWaitStrategy(config.rateLimitMs)
