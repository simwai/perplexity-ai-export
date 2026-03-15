import type { Page } from 'patchright'
import { logger } from './logger.js'

/**
 * Detects if a page is currently showing a Cloudflare challenge.
 * Attempts to solve it by clicking the checkbox if possible.
 * Returns true if the page is still blocked after the attempt.
 */
export async function handleCloudflare(page: Page): Promise<boolean> {
  const isCloudflare = await page.evaluate(() => {
    const title = document.title.toLowerCase()
    return title.includes('cloudflare') ||
           title.includes('just a moment') ||
           !!document.querySelector('#cloudflare-challenge') ||
           !!document.querySelector('.cf-browser-verification') ||
           !!document.querySelector('iframe[src*="cloudflare"]')
  })

  if (!isCloudflare) return false

  logger.warn('Cloudflare challenge detected! Attempting automatic bypass...')

  try {
    // Look for the Turnstile/Challenge iframe
    const frames = page.frames()
    const challengeFrame = frames.find(f => f.url().includes('cloudflare') || f.name().includes('cf-'))

    if (challengeFrame) {
      const checkbox = challengeFrame.locator('input[type="checkbox"], #challenge-stage')
      if (await checkbox.isVisible({ timeout: 5000 })) {
        logger.info('Cloudflare checkbox found, clicking...')
        await checkbox.click()
        // Wait for potential navigation/refresh after click
        await page.waitForTimeout(4000)
      }
    } else {
      // Direct locator attempt as fallback
      const checkbox = page.locator('iframe[title*="Cloudflare security challenge"]').contentFrame().locator('#challenge-stage')
      if (await checkbox.isVisible({ timeout: 2000 })) {
        await checkbox.click()
        await page.waitForTimeout(4000)
      }
    }
  } catch (_error) {
    logger.debug('Cloudflare interaction failed or timed out.')
  }

  // Final verification
  const stillBlocked = await page.evaluate(() => {
    const title = document.title.toLowerCase()
    return title.includes('cloudflare') || title.includes('just a moment')
  })

  if (stillBlocked) {
    logger.error('Still blocked by Cloudflare after bypass attempt.')
  } else {
    logger.success('Cloudflare bypass seems successful!')
  }

  return stillBlocked
}
