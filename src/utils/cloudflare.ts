import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'
import { OllamaClient } from '../ai/ollama-client.js'

const ollama = new OllamaClient()

/**
 * Advanced Cloudflare Bypass using Vision and Behavioral Modeling
 */
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

  logger.warn('Cloudflare challenge detected! Engaging Vision-based bypass protocol...')

  // Force exact 1920x1080 viewport for coordinate consistency
  await page.setViewportSize({ width: 1920, height: 1080 })
  await HumanNavigator.simulateBrowsing(page)

  try {
    // 1. Capture the visual state
    const screenshot = await page.screenshot({ type: 'png' })
    const base64Image = screenshot.toString('base64')

    // 2. Ask Ollama for the coordinates
    const prompt = `Identify the exact pixel coordinates (x, y) of the "Verify you are human" checkbox or the Cloudflare/Turnstile interaction area.
    The image is 1920x1080. Turnstile checkboxes are often centered or slightly left of center.
    Provide the 3 most likely (x, y) pairs in order of confidence.
    Format your response as a JSON array of objects: [{"x": 100, "y": 200}, {"x": 110, "y": 210}, {"x": 90, "y": 190}]`

    const response = await ollama.generateWithVision(prompt, base64Image)
    const coordinatesMatch = response.match(/\[.*\]/s)

    if (coordinatesMatch) {
      const coordinates = JSON.parse(coordinatesMatch[0]) as Array<{ x: number, y: number }>

      for (const coord of coordinates.slice(0, 3)) {
        logger.info(`Attempting Vision-based click at (${coord.x}, ${coord.y})...`)

        // Use curved movement to the coordinate
        await HumanNavigator.moveMouseCurved(page, coord.x, coord.y)
        await page.waitForTimeout(500 + Math.random() * 500)

        // Perform humanized click
        await page.mouse.click(coord.x, coord.y, { delay: 150 + Math.random() * 100 })

        // Wait to see if it worked
        await page.waitForTimeout(5000)

        const stillBlocked = await page.evaluate(() => {
          const title = document.title.toLowerCase()
          return title.includes('cloudflare') || title.includes('just a moment')
        })

        if (!stillBlocked) {
          logger.success('Cloudflare Vision-based bypass successful!')
          return false
        }
      }
    }
  } catch (e) {
    logger.error(`Vision bypass failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Fallback to standard frame-based attempt if vision fails or doesn't resolve it
  logger.info('Vision attempt inconclusive. Falling back to frame-level interaction...')
  return await standardFrameBypass(page)
}

async function standardFrameBypass(page: Page): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const frames = page.frames()
      const challengeFrame = frames.find(f => f.url().includes('cloudflare') || f.name().includes('cf-'))

      if (challengeFrame) {
        const checkbox = challengeFrame.locator('input[type="checkbox"], #challenge-stage, .mark').first()
        if (await checkbox.isVisible({ timeout: 2000 })) {
          const box = await checkbox.boundingBox()
          if (box) {
            await HumanNavigator.moveMouseCurved(page, box.x + box.width / 2, box.y + box.height / 2)
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 200 })
            await page.waitForTimeout(6000)
          }
        }
      }

      const stillBlocked = await page.evaluate(() => {
        return document.title.toLowerCase().includes('cloudflare') || document.title.toLowerCase().includes('just a moment')
      })

      if (!stillBlocked) return false
    } catch { /* ignore */ }
  }
  return true
}
