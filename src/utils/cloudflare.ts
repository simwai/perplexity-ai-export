import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'

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

  logger.warn('Cloudflare challenge detected! Engaging behavioral bypass...')

  // 1. Warm up the page with some random browsing activity
  await HumanNavigator.simulateBrowsing(page)

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.waitForTimeout(2000 + Math.random() * 2000)

      const frames = page.frames()
      const challengeFrame = frames.find(f => f.url().includes('cloudflare') || f.name().includes('cf-'))

      if (challengeFrame) {
        logger.info(`Attempt ${attempt}: Interacting with challenge frame...`)

        const selectors = [
          'input[type="checkbox"]',
          '#challenge-stage',
          '.mark',
          '#checkbox',
          'span.cb-i'
        ]

        for (const selector of selectors) {
          const locator = challengeFrame.locator(selector)
          if (await locator.isVisible({ timeout: 2000 })) {
            const box = await locator.boundingBox()
            if (box) {
              // Hover for a bit before clicking
              await HumanNavigator.moveMouseCurved(page, box.x + box.width / 2, box.y + box.height / 2)
              await page.waitForTimeout(400 + Math.random() * 600)

              // Human-like click
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 150 + Math.random() * 100 })
              logger.success(`Interacted with ${selector}`)
            } else {
              await locator.click({ force: true, delay: 200 })
            }

            await page.waitForTimeout(6000 + Math.random() * 2000)
            break
          }
        }
      } else {
        // If no frame, maybe try moving mouse to a common center position
        const view = page.viewportSize() || { width: 1280, height: 720 }
        await HumanNavigator.moveMouseCurved(page, view.width / 2, view.height / 2)
        await page.waitForTimeout(3000)
        if (attempt === 3) await page.reload({ waitUntil: 'networkidle' })
      }

      const stillBlocked = await page.evaluate(() => {
        const title = document.title.toLowerCase()
        return title.includes('cloudflare') || title.includes('just a moment') || title.includes('checking your browser')
      })

      if (!stillBlocked) {
        logger.success('Cloudflare behavioral bypass successful!')
        return false
      }
    } catch (e) {
      logger.debug(`Attempt ${attempt} failed: ${e}`)
    }
  }

  logger.error('Behavioral bypass failed. Cloudflare still active.')
  return true
}
