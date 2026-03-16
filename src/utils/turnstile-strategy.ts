import type { Page } from 'patchright'
import { logger } from './logger.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { createCursor } from 'ghost-cursor-patchright-core'
import { Jimp } from 'jimp'

const ai = getAiProvider()

export interface TurnstileStrategy {
  solve(page: Page): Promise<boolean>
}

export class StructuralTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)
    const widget = page.locator('div.cf-turnstile, #turnstile-widget, iframe[src*="turnstile"]').first()

    if (!(await widget.isVisible({ timeout: 5000 }))) return false

    const box = await widget.boundingBox()
    if (!box) return false

    const points = [
      { x: box.x + 30, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + 10, y: box.y + 10 }
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

export class VisionTurnstileStrategy implements TurnstileStrategy {
  async solve(page: Page): Promise<boolean> {
    const cursor = createCursor(page)

    // 1. Capture original screenshot (1920x1080)
    const rawBuffer = await page.screenshot({ type: 'jpeg', quality: 80 })

    // 2. Resize by 50% using Jimp (to 960x540) to reduce payload size
    const image = await Jimp.read(rawBuffer)
    image.resize({ w: 960 })
    const resizedBuffer = await image.getBuffer('image/jpeg', { quality: 60 })
    const base64Image = resizedBuffer.toString('base64')

    for (let attempt = 1; attempt <= 3; attempt++) {
      const temperature = 0.1
      const prompt = `CRITICAL: You are a coordinate extraction engine.
      Identify the EXACT center pixel coordinates (x, y) of the "Verify you are human" checkbox in this 960x540 image.

      RULES:
      1. Return ONLY a JSON array.
      2. USE NUMBERS from the 960x540 coordinate space.
      3. NO TEXT, NO COMMENTS, NO PROSE.

      Example valid response: [{"x": 480, "y": 270}]`

      try {
        const response = await ai.generateWithVision(prompt, base64Image, { temperature })
        const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

        if (jsonMatch) {
          const cleanedJson = jsonMatch[0]
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<.*?>/g, '0')

          const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

          for (const coord of coordinates.slice(0, 3)) {
            if (typeof coord.x !== 'number' || typeof coord.y !== 'number') continue

            // 3. Scale coordinates back up to 1920x1080 (multiply by 2)
            const scaledX = coord.x * 2
            const scaledY = coord.y * 2

            logger.info(`    [Vision Attempt ${attempt}] Targeting coordinates (${scaledX}, ${scaledY})...`)
            await cursor.click({ x: scaledX, y: scaledY } as any)
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
