import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'
import { getAiProvider } from '../ai/ai-provider.js'
import chalk from 'chalk'

const ai = getAiProvider()

/**
 * Multi-Strategy Cloudflare/Turnstile Bypass
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

  const sequenceHeader = chalk.bold.cyan('\n[CAPTCHA BYPASS SEQUENCE]')
  logger.info(`${sequenceHeader} Cloudflare challenge detected!`)

  // Force viewport and establish signatures
  await page.setViewportSize({ width: 1920, height: 1080 })
  await HumanNavigator.simulateBrowsing(page)

  // --- STRATEGY 1: Structural Turnstile Interaction (New Primary) ---
  logger.info(chalk.yellow('  - Strategy 1: Structural Turnstile Interaction (Primary)...'))
  const solvedViaStructure = await structuralBypass(page)
  if (solvedViaStructure) {
    logger.success(`${chalk.bold.green('[BYPASS SUCCESS]')} Challenge resolved via structural interaction!\n`)
    return false
  }

  // --- STRATEGY 2: Vision-Based Analysis (Fallback) ---
  logger.info(chalk.yellow('  - Strategy 1 failed. Strategy 2: Vision-Based Fallback...'))
  const solvedViaVision = await visionBypass(page)
  if (solvedViaVision) {
    logger.success(`${chalk.bold.green('[BYPASS SUCCESS]')} Challenge resolved via visual analysis!\n`)
    return false
  }

  logger.error(`${chalk.bold.red('[BYPASS FAILED]')} All strategies exhausted. Failing fast.\n`)
  throw new Error('Cloudflare bypass exhausted all strategies. Failing fast.')
}

/**
 * Targets the Turnstile container structure directly (inspired by Python POC)
 */
async function structuralBypass(page: Page): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const turnstileResponse = await page.inputValue('[name=cf-turnstile-response]').catch(() => '')
      if (turnstileResponse) return true

      // Locate the interaction area - looking for the widget or its iframe wrapper
      const widget = page.locator('div.cf-turnstile, #turnstile-widget, iframe[src*="turnstile"]').first()

      if (await widget.isVisible({ timeout: 3000 })) {
        const box = await widget.boundingBox()
        if (box) {
          logger.info(`    [Attempt ${attempt}] Clicking Turnstile widget at (${box.x}, ${box.y})...`)
          await HumanNavigator.moveMouseCurved(page, box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 150 })
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

/**
 * Visual coordination fallback
 */
async function visionBypass(page: Page): Promise<boolean> {
  const screenshot = await page.screenshot({ type: 'png' })
  const base64Image = screenshot.toString('base64')

  for (let attempt = 1; attempt <= 3; attempt++) {
    const temperature = 0.2 - (attempt * 0.05)
    const prompt = `Identify exact center pixel (x, y) of the human verification checkbox in this 1920x1080 image.
    Return ONLY a JSON array: [{"x": 960, "y": 540}]`

    try {
      const response = await ai.generateWithVision(prompt, base64Image, { temperature: Math.max(0, temperature) })
      const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

      if (jsonMatch) {
        const coordinates = JSON.parse(jsonMatch[0].replace(/\/\/.*$/gm, '')) as Array<{ x: number, y: number }>
        for (const coord of coordinates.slice(0, 3)) {
          await HumanNavigator.moveMouseCurved(page, coord.x, coord.y)
          await page.mouse.click(coord.x, coord.y, { delay: 180 })
          await page.waitForTimeout(5000)

          const stillBlocked = await page.evaluate(() => {
            const t = document.title.toLowerCase()
            return t.includes('cloudflare') || t.includes('just a moment')
          })
          if (!stillBlocked) return true
        }
      }
    } catch { /* ignore */ }
  }
  return false
}
