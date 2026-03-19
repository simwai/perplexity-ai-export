import type { Page } from 'patchright'
import { logger } from './logger.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { createCursor } from 'ghost-cursor-patchright-core'
import { Jimp } from 'jimp'
import { VisualLogger } from './visual-logger.js'

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

    if (!(await widget.isVisible({ timeout: 5000 }))) {
      await VisualLogger.captureAction(page, 'structural_no_widget')
      return false
    }

    const box = await widget.boundingBox()
    if (!box) return false

    const points = [
      { x: box.x + 30, y: box.y + box.height / 2, name: 'left' },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, name: 'center' },
      { x: box.x + 10, y: box.y + 10, name: 'topleft' }
    ]

    for (const [idx, point] of points.entries()) {
      try {
        await VisualLogger.captureAction(page, `structural_attempt_${idx + 1}_pre_${point.name}`, point.x, point.y)

        logger.info(`    [Structural Attempt ${idx + 1}] Clicking ${point.name} zone at (${Math.round(point.x)}, ${Math.round(point.y)})...`)
        await cursor.click({ x: point.x, y: point.y } as any)

        // Base 5s + random jitter up to 2s
        await page.waitForTimeout(14000 + Math.random() * 2000)

        const solved = await this.isSolved(page)
        if (solved) {
          await VisualLogger.captureAction(page, `structural_success_${point.name}`)
          return true
        }
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
    const rawBuffer = await page.screenshot({ type: 'jpeg', quality: 80 })
    const image = await Jimp.read(rawBuffer)
    image.resize({ w: 960 })
    const resizedBuffer = await image.getBuffer('image/jpeg', { quality: 60 })
    const base64Image = resizedBuffer.toString('base64')

    await VisualLogger.captureAction(page, 'vision_analysis_start')

    for (let attempt = 1; attempt <= 3; attempt++) {
      const temperature = 0.1
      const prompt = `CRITICAL: You are a coordinate extraction engine.
      Identify the EXACT center pixel coordinates (x, y) of the "Verify you are human" checkbox in this 960x540 image.
      Return ONLY a JSON array. Example: [{"x": 480, "y": 270}]`

      try {
        const response = await ai.generateWithVision(prompt, base64Image, { temperature })
        const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

        if (jsonMatch) {
          const cleanedJson = jsonMatch[0].replace(/<.*?>/g, '0')
          const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

          for (const [cIdx, coord] of coordinates.slice(0, 3).entries()) {
            if (typeof coord.x !== 'number' || typeof coord.y !== 'number') continue

            const scaledX = coord.x * 2
            const scaledY = coord.y * 2

            await VisualLogger.captureAction(page, `vision_attempt_${attempt}_target_${cIdx + 1}`, scaledX, scaledY)

            logger.info(`    [Vision Attempt ${attempt}] Targeting coordinates (${scaledX}, ${scaledY})...`)
            await cursor.click({ x: scaledX, y: scaledY } as any)

            // Base 5s + random jitter up to 2s
            await page.waitForTimeout(14000 + Math.random() * 2000)

            const stillBlocked = await page.evaluate(() => {
              const title = document.title.toLowerCase()
              return title.includes('cloudflare') || title.includes('just a moment')
            })
            if (!stillBlocked) {
              await VisualLogger.captureAction(page, 'vision_success')
              return true
            }
          }
        }
      } catch (e) {
        logger.error(`    [Vision Attempt ${attempt}] Error: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return false
  }
}
