import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'
import { getAiProvider } from '../ai/ai-provider.js'
import { config } from './config.js'
import chalk from 'chalk'

const ai = getAiProvider()

/**
 * Advanced Cloudflare Bypass with Visual AI Coordination
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
  logger.info(`${sequenceHeader} Cloudflare challenge detected! Engaging Vision-based protocol...`)
  logger.info(`  - Provider: ${config.llmSource}`)
  logger.info(`  - Vision Model: ${config.llmVisionModel}`)

  await page.setViewportSize({ width: 1920, height: 1080 })

  logger.info(`  - Action: Initializing human-like behavioral signatures...`)
  await HumanNavigator.simulateBrowsing(page)

  logger.info(`  - Action: Capturing 1920x1080 visual state for AI analysis...`)
  const screenshot = await page.screenshot({ type: 'png' })
  const base64Image = screenshot.toString('base64')

  for (let attempt = 1; attempt <= 3; attempt++) {
    const temperature = 0.3 - (attempt * 0.1)
    const pressure = attempt === 1 ? "" : attempt === 2 ? "IMPORTANT: You must return ONLY valid JSON." : "CRITICAL: Return ONLY the JSON array. NO TEXT, NO COMMENTS."

    logger.info(chalk.yellow(`  - Attempt ${attempt}/3: Querying AI for checkbox coordinates (temp: ${temperature.toFixed(2)})...`))

    const prompt = `Task: Identify the exact center pixel coordinates (x, y) of the "Verify you are human" checkbox in this 1920x1080 screenshot.
    Context: The checkbox is typically inside a small widget in the center or left-center of the screen.
    Format: Return ONLY a raw JSON array of the 3 most likely center-points: [{"x": 960, "y": 540}, ...]
    ${pressure}`

    try {
      const response = await ai.generateWithVision(prompt, base64Image, { temperature: Math.max(0, temperature) })
      const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s)

      if (jsonMatch) {
        const cleanedJson = jsonMatch[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const coordinates = JSON.parse(cleanedJson) as Array<{ x: number, y: number }>

        logger.info(`  - Success: AI identified ${coordinates.length} potential targets.`)

        for (const [idx, coord] of coordinates.slice(0, 3).entries()) {
          logger.info(`    [Target ${idx + 1}] Moving to (${coord.x}, ${coord.y}) and clicking...`)

          await HumanNavigator.moveMouseCurved(page, coord.x, coord.y)
          await page.waitForTimeout(400 + Math.random() * 400)
          await page.mouse.click(coord.x, coord.y, { delay: 180 })

          logger.info(`    [Target ${idx + 1}] Waiting for challenge resolution...`)
          await page.waitForTimeout(6000)

          const stillBlocked = await page.evaluate(() => {
            const title = document.title.toLowerCase()
            const body = document.body.innerText.toLowerCase()
            return title.includes('cloudflare') || title.includes('just a moment') || body.includes('verify you are human')
          })

          if (!stillBlocked) {
            logger.success(`${chalk.bold.green('[BYPASS SUCCESS]')} Cloudflare challenge resolved via visual analysis!\n`)
            return false
          } else {
            logger.warn(`    [Target ${idx + 1}] Page still blocked. Trying next target...`)
          }
        }
      } else {
        logger.warn(`  - Warning: AI response did not contain a valid coordinate array.`)
      }
    } catch (e) {
      logger.error(`  - Error: AI request failed on attempt ${attempt}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  logger.error(`${chalk.bold.red('[BYPASS FAILED]')} All vision-based attempts exhausted. Failing fast to prevent detection.\n`)
  throw new Error('Cloudflare bypass exhausted all retries. Failing fast.')
}
