import type { Page } from '@playwright/test'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logging/logger.js'
import { from, type Result } from 'super-result'
import { BaseAppError } from '../utils/errors.js'

export class SelectorWaitError extends BaseAppError {}
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
    const result = await from(async () => {
      await page.waitForLoadState('networkidle', {
        timeout: DynamicWaitStrategy.NETWORK_IDLE_TIMEOUT_MS,
      })
    })
    if (!result.ok) {
      logger.debug('afterClick: networkidle wait timed out; continuing', result.error)
    }
  }

  async afterScroll(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded')
  }

  async forSelector(
    page: Page,
    selector: string
  ): Promise<Result<void, SelectorWaitErrorInstance>> {
    return from(async () => {
      await page.waitForSelector(selector, {
        state: 'visible',
        timeout: DynamicWaitStrategy.SELECTOR_TIMEOUT_MS,
      })
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

  async forSelector(
    page: Page,
    _selector: string
  ): Promise<Result<void, SelectorWaitErrorInstance>> {
    return from(async () => {
      await this.randomPause(page)
    })
  }
}

export const createWaitStrategy = (config: Config): WaitStrategy => {
  const isDynamicMode = config.waitMode === 'dynamic'
  return isDynamicMode ? new DynamicWaitStrategy() : new StaticWaitStrategy(config.rateLimitMs)
}
