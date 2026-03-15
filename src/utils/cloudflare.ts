import type { Page } from 'patchright'
import { logger } from './logger.js'

/**
 * Detects and attempts to bypass Cloudflare challenges.
 * Returns true if the page is STILL blocked after attempts.
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

  logger.warn('Cloudflare challenge detected! Initiating bypass protocol...')

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // 1. Wait for the challenge frame to be available
      await page.waitForTimeout(2000)

      const frames = page.frames()
      const challengeFrame = frames.find(f => f.url().includes('cloudflare') || f.name().includes('cf-'))

      if (challengeFrame) {
        logger.info(`Attempt ${attempt}: Found challenge frame. Seeking checkbox...`)

        // Try various selectors for the "checkbox" area
        const selectors = [
          'input[type="checkbox"]',
          '#challenge-stage',
          '.mark',
          '#checkbox',
          'span.cb-i'
        ]

        for (const selector of selectors) {
          const locator = challengeFrame.locator(selector)
          if (await locator.isVisible({ timeout: 1000 })) {
            logger.info(`Clicking Cloudflare element: ${selector}`)

            // Humanized click: Move mouse first, then click
            const box = await locator.boundingBox()
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 150 })
            } else {
              await locator.click({ force: true })
            }

            await page.waitForTimeout(5000)
            break
          }
        }
      } else {
        logger.info(`Attempt ${attempt}: No explicit frame found, waiting or reloading...`)
        await page.waitForTimeout(3000)
        if (attempt === 3) await page.reload({ waitUntil: 'networkidle' })
      }

      // Check if we passed
      const stillBlocked = await page.evaluate(() => {
        const title = document.title.toLowerCase()
        return title.includes('cloudflare') || title.includes('just a moment') || title.includes('checking your browser')
      })

      if (!stillBlocked) {
        logger.success('Cloudflare bypass successful!')
        return false
      }
    } catch (e) {
      logger.debug(`Bypass attempt ${attempt} failed: ${e}`)
    }
  }

  logger.error('Exhausted all Cloudflare bypass attempts.')
  return true
}
