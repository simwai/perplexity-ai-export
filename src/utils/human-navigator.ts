import type { Page } from 'patchright'

export class HumanNavigator {
  /**
   * Move mouse from current position to (x, y) using a curved path
   */
  static async moveMouseCurved(page: Page, targetX: number, targetY: number): Promise<void> {
    const steps = 25 + Math.floor(Math.random() * 20)

    // Simple quadratic Bezier curve logic
    // We need a control point that isn't on the line between current and target
    const currentX = Math.random() * 1000 // Just a guess, Playwright doesn't expose current pos easily
    const currentY = Math.random() * 800

    const controlX = (currentX + targetX) / 2 + (Math.random() - 0.5) * 200
    const controlY = (currentY + targetY) / 2 + (Math.random() - 0.5) * 200

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = (1 - t) * (1 - t) * currentX + 2 * (1 - t) * t * controlX + t * t * targetX
      const y = (1 - t) * (1 - t) * currentY + 2 * (1 - t) * t * controlY + t * t * targetY

      await page.mouse.move(x, y)
      // Variable speed
      await new Promise((r) => setTimeout(r, Math.random() * 10 + 2))
    }
  }

  /**
   * Human-like scrolling with acceleration and deceleration
   */
  static async scrollNaturally(page: Page, amount: number): Promise<void> {
    const steps = 15 + Math.floor(Math.random() * 10)
    let currentScroll = 0

    for (let i = 1; i <= steps; i++) {
      // Sinusoidal easing for smooth acceleration/deceleration
      const t = i / steps
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      const nextScroll = amount * ease
      const delta = nextScroll - currentScroll

      await page.mouse.wheel(0, delta)
      currentScroll = nextScroll

      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100))
    }
  }

  /**
   * Performs random mouse movements to simulate "browsing"
   */
  static async simulateBrowsing(page: Page): Promise<void> {
    const movements = 2 + Math.floor(Math.random() * 3)
    const viewport = page.viewportSize() || { width: 1280, height: 720 }

    for (let i = 0; i < movements; i++) {
      const x = Math.random() * viewport.width
      const y = Math.random() * viewport.height
      await this.moveMouseCurved(page, x, y)

      if (Math.random() > 0.7) {
        await this.scrollNaturally(page, (Math.random() - 0.5) * 400)
      }

      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000))
    }
  }
}
