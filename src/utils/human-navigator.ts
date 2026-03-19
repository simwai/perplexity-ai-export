import type { Page } from 'patchright'
import { createCursor } from 'ghost-cursor-patchright-core'

export class HumanNavigator {
  /**
   * Move mouse and click using ghost-cursor
   */
  static async moveAndClick(page: Page, x: number, y: number): Promise<void> {
    const cursor = createCursor(page)
    await cursor.click({ x, y } as any)
  }

  /**
   * Move mouse using ghost-cursor
   */
  static async moveMouseCurved(page: Page, x: number, y: number): Promise<void> {
    const cursor = createCursor(page)
    await cursor.moveTo({ x, y } as any)
  }

  /**
   * Human-like scrolling with acceleration and deceleration
   */
  static async scrollNaturally(page: Page, amount: number): Promise<void> {
    const steps = 15 + Math.floor(Math.random() * 10)
    let currentScroll = 0
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      const nextScroll = amount * ease
      const delta = nextScroll - currentScroll
      await page.mouse.wheel(0, delta)
      currentScroll = nextScroll
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100))
    }
  }

  /**
   * Performs random movements to simulate "browsing"
   */
  static async simulateBrowsing(page: Page): Promise<void> {
    const cursor = createCursor(page)
    const viewport = page.viewportSize() || { width: 1280, height: 720 }
    for (let i = 0; i < 3; i++) {
      const x = Math.random() * viewport.width
      const y = Math.random() * viewport.height
      await cursor.moveTo({ x, y } as any)
      if (Math.random() > 0.7) await this.scrollNaturally(page, (Math.random() - 0.5) * 400)
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000))
    }
  }
}
