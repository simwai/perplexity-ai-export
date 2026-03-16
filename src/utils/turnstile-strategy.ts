import type { Page } from 'patchright'
import { logger } from './logger.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { createCursor } from 'ghost-cursor-patchright-core'

const ai = getAiProvider()

export interface TurnstileStrategy {
  solve(page: Page): Promise<boolean>
}

/**
 * Strategy 1: Multi-point structural interaction
 */
export class StructuralTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)
    const widget = page.locator('div.cf-turnstile, #turnstile-widget, iframe[src*="turnstile"]').first()

    if (!(await widget.isVisible({ timeout: 5000 }))) return false

    const box = await widget.boundingBox()
    if (!box) return false

    // Turnstile hitboxes are typically on the left side of the widget
    const points = [
      { x: box.x + 30, y: box.y + box.height / 2 }, // Left side (common checkbox pos)
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }, // Center
      { x: box.x + 10, y: box.y + 10 } // Top left
    ]

    for (const [idx, point] of points.entries()) {
      try {
        logger.info(`    [Structural Attempt ${idx + 1}] Clicking Turnstile zone at (${Math.round(point.x)}, ${Math.round(point.y)})...`)
        await cursor.click({ x: point.x, y: point.y } as any)
        await page.waitForTimeout(4000)

        const solved = await this.isSolved(page)
        if (solved) return true
      } catch { /* ignore */ }
    }
    return false
  }

  private async isSolved(page: Page): Promise<boolean> {
    const response = await page.inputValue('[name=cf-turnstile-response]').catch(() => '')
    if (response && response.length > 10) return true

    const stillBlocked = await page.evaluate(() => {
      const t = document.title.toLowerCase()
      return t.includes('cloudflare') || t.includes('just a moment') || !!document.querySelector('#cloudflare-challenge')
    })
    return !stillBlocked
  }
}

/**
 * Strategy 2: Improved Vision interaction
 */
export class VisionTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)
    const screenshot = await page.screenshot({ type: 'png' })
    const base64Image = screenshot.toString('base64')

    for (let attempt = 1; attempt <= 3; attempt++) {
      const temperature = 0.1 // Extremely low for precision
      const prompt = `CRITICAL: You are a coordinate extraction engine.
      Identify the EXACT pixel coordinates (x, y) of the "Verify you are human" checkbox in this 1920x1080 image.

      RULES:
      1. Return ONLY a JSON array.
      2. NO PLACEHOLDERS like <center_x>.
      3. NO TEXT, NO COMMENTS, NO PROSE.
      4. Use REAL NUMBERS found from the image.

      Example valid response: [{"x": 960, "y": 540}]`

      try {
        const response = await ai.generateWithVision(prompt, base64Image, { temperature })
        // Enhanced cleaning: remove anything that's not the JSON array
        const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

        if (jsonMatch) {
          const cleanedJson = jsonMatch[0]
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<.*?>/g, '0') // Replace any remaining placeholders with 0 to prevent parse error

          const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

          for (const coord of coordinates.slice(0, 3)) {
            if (typeof coord.x !== 'number' || typeof coord.y !== 'number') continue

            logger.info(`    [Vision Attempt ${attempt}] Targeting coordinates (${coord.x}, ${coord.y})...`)
            await cursor.click({ x: coord.x, y: coord.y } as any)
            await page.waitForTimeout(5000)

            const stillBlocked = await page.evaluate(() => {
              const title = document.title.toLowerCase()
              return title.includes('cloudflare') || title.includes('just a moment')
            })
            if (!stillBlocked) return true
          }
        } else {
            logger.warn(`    [Vision Attempt ${attempt}] LLM failed to provide valid JSON.`)
        }
      } catch (e) {
        logger.error(`    [Vision Attempt ${attempt}] Error: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return false
  }
}
