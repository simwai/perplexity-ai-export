import type { Page } from 'patchright'
import { type Config } from './config.js'

export interface WaitStrategy {
  afterClick(webPage: Page): Promise<void>
  afterScroll(webPage: Page): Promise<void>
  forSelector(webPage: Page, elementSelector: string): Promise<void>
}

class DynamicNetworkWaitStrategy implements WaitStrategy {
  async afterClick(webPage: Page): Promise<void> {
    const NETWORK_IDLE_TIMEOUT_MILLISECONDS = 2000
    await webPage.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MILLISECONDS }).catch(() => {})
  }

  async afterScroll(webPage: Page): Promise<void> {
    await webPage.waitForLoadState('domcontentloaded')
  }

  async forSelector(webPage: Page, elementSelector: string): Promise<void> {
    const SELECTOR_VISIBILITY_TIMEOUT_MILLISECONDS = 5000
    await webPage.waitForSelector(elementSelector, { state: 'visible', timeout: SELECTOR_VISIBILITY_TIMEOUT_MILLISECONDS })
  }
}

class StaticDelayWaitStrategy implements WaitStrategy {
  constructor(private readonly baseDelayMilliseconds: number) {}

  private async pauseWithJitter(webPage: Page) {
    const jitterFactor = 0.5
    const randomJitter = Math.random() * this.baseDelayMilliseconds * jitterFactor
    const totalWaitTime = this.baseDelayMilliseconds + randomJitter
    await webPage.waitForTimeout(totalWaitTime)
  }

  async afterClick(webPage: Page) { await this.pauseWithJitter(webPage) }
  async afterScroll(webPage: Page) { await this.pauseWithJitter(webPage) }
  async forSelector(webPage: Page) { await this.pauseWithJitter(webPage) }
}

export const createWaitStrategy = (applicationConfig: Config): WaitStrategy => {
  const isDynamicMode = applicationConfig.waitMode === 'dynamic'
  return isDynamicMode
    ? new DynamicNetworkWaitStrategy()
    : new StaticDelayWaitStrategy(applicationConfig.rateLimitMs)
}
