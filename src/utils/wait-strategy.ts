import type { Page } from 'patchright'
import { type Config } from './config.js'

export interface WaitStrategy {
  afterClick(page: Page): Promise<void>
  afterScroll(page: Page): Promise<void>
  forSelector(page: Page, selector: string): Promise<void>
}

class DynamicWait implements WaitStrategy {
  async afterClick(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {})
  }
  async afterScroll(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded')
  }
  async forSelector(page: Page, sel: string): Promise<void> {
    await page.waitForSelector(sel, { state: 'visible', timeout: 5000 })
  }
}

class StaticWait implements WaitStrategy {
  constructor(private readonly delay: number) {}
  private async pause(page: Page) {
    await page.waitForTimeout(this.delay + Math.random() * this.delay * 0.5)
  }
  async afterClick(page: Page) { await this.pause(page) }
  async afterScroll(page: Page) { await this.pause(page) }
  async forSelector(page: Page) { await this.pause(page) }
}

export const waitStrategy = (cfg: Config): WaitStrategy =>
  cfg.waitMode === 'dynamic' ? new DynamicWait() : new StaticWait(cfg.rateLimitMs)
