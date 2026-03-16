import type { Page } from 'patchright'
import { logger } from './logger.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { createCursor } from 'ghost-cursor-patchright-core'

const ai = getAiProvider()

export interface TurnstileStrategy {
  solve(page: Page): Promise<boolean>
}

export class StructuralTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const turnstileResponse = await page.inputValue('[name=cf-turnstile-response]').catch(() => '')
        if (turnstileResponse) return true

        const widget = page.locator('div.cf-turnstile, #turnstile-widget, iframe[src*="turnstile"]').first()
        if (await widget.isVisible({ timeout: 3000 })) {
          const box = await widget.boundingBox()
          if (box) {
            logger.info(`    [Structural Attempt ${attempt}] Clicking Turnstile widget at (${box.x}, ${box.y})...`)
            await cursor.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 } as any)
            await page.waitForTimeout(4000)
          }
        }

        const stillBlocked = await page.evaluate(() => {
          const t = document.title.toLowerCase()
          return t.includes('cloudflare') || t.includes('just a moment') || !!document.querySelector('[name=cf-turnstile-response]:empty')
        })

        if (!stillBlocked) return true
      } catch { /* ignore */ }
    }
    return false
  }
}

export class VisionTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)
    const screenshot = await page.screenshot({ type: 'png' })
    const base64Image = screenshot.toString('base64')

    for (let attempt = 1; attempt <= 3; attempt++) {
      const temperature = 0.2 - (attempt * 0.05)
      const prompt = `Task: Identify the exact center pixel coordinates (x, y) of the "Verify you are human" checkbox.
      Image: 1920x1080. Return ONLY a raw JSON array of the 3 most likely center-points.
      Example: [{"x": 960, "y": 540}]`

      try {
        const response = await ai.generateWithVision(prompt, base64Image, { temperature: Math.max(0, temperature) })
        const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

        if (jsonMatch) {
          const cleanedJson = jsonMatch[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
          const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

          for (const coord of coordinates.slice(0, 3)) {
            logger.info(`    [Vision Attempt ${attempt}] Targeting pixels (${coord.x}, ${coord.y})...`)
            await cursor.click({ x: coord.x, y: coord.y } as any)
            await page.waitForTimeout(5000)

            const stillBlocked = await page.evaluate(() => {
              const title = document.title.toLowerCase()
              return title.includes('cloudflare') || title.includes('just a moment')
            })
            if (!stillBlocked) return true
          }
        }
      } catch (e) {
        logger.error(`    [Vision Attempt ${attempt}] Failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return false
  }
}
