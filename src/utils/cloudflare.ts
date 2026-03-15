import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { config } from './config.js'

const ai = getAiProvider()

export async function handleCloudflare(page: Page): Promise<boolean> {
  const isBlocked = await page.evaluate(() => {
    const title = document.title.toLowerCase()
    const body = document.body.innerText.toLowerCase()
    return title.includes('cloudflare') ||
           title.includes('just a moment') ||
           title.includes('checking your browser') ||
           body.includes('verify you are human') ||
           !!document.querySelector('#cloudflare-challenge') ||
           !!document.querySelector('.cf-browser-verification')
  })

  if (!isBlocked) return false

  logger.warn(`Cloudflare challenge detected! Engaging Vision-based bypass with ${config.llmVisionModel}...`)

  await page.setViewportSize({ width: 1920, height: 1080 })
  await HumanNavigator.simulateBrowsing(page)

  const screenshot = await page.screenshot({ type: 'png' })
  const base64Image = screenshot.toString('base64')

  for (let attempt = 1; attempt <= 3; attempt++) {
    const temperature = 0.5 - (attempt * 0.15)
    const pressure = attempt === 1 ? "" : attempt === 2 ? "IMPORTANT: You must return ONLY valid JSON." : "CRITICAL: Return ONLY the JSON array. NO TEXT, NO COMMENTS."

    const prompt = `Identify the exact pixel coordinates (x, y) of the "Verify you are human" checkbox.
    The image is 1920x1080.
    ${pressure}
    Return ONLY a JSON array of objects:
    [{"x": 123, "y": 456}, {"x": 125, "y": 458}, {"x": 120, "y": 450}]`

    try {
      const response = await ai.generateWithVision(prompt, base64Image, { temperature: Math.max(0, temperature) })
      const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

      if (jsonMatch) {
        const cleanedJson = jsonMatch[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

        for (const coord of coordinates.slice(0, 3)) {
          logger.info(`Attempt ${attempt}: Clicking Vision target (${coord.x}, ${coord.y})...`)
          await HumanNavigator.moveMouseCurved(page, coord.x, coord.y)
          await page.waitForTimeout(500)
          await page.mouse.click(coord.x, coord.y, { delay: 150 })
          await page.waitForTimeout(5000)

          const stillBlocked = await page.evaluate(() => {
            const title = document.title.toLowerCase()
            return title.includes('cloudflare') || title.includes('just a moment')
          })

          if (!stillBlocked) {
            logger.success('Vision-based bypass successful!')
            return false
          }
        }
      }
    } catch (e) {
      logger.error(`Attempt ${attempt} error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error('Cloudflare bypass exhausted all retries. Failing fast to prevent hanging/blacklisting.')
}
