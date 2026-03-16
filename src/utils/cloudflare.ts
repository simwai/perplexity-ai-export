import type { Page } from 'patchright'
import { logger } from './logger.js'
import { HumanNavigator } from './human-navigator.js'
import { CloudflareBypassError } from './errors.js'
import { StructuralTurnstileStrategy, VisionTurnstileStrategy, type TurnstileStrategy } from './turnstile-strategy.js'
import chalk from 'chalk'

const strategies: TurnstileStrategy[] = [
  new StructuralTurnstileStrategy(),
  new VisionTurnstileStrategy()
]

/**
 * Advanced Cloudflare Bypass with Multi-Strategy Fallback
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

  await page.setViewportSize({ width: 1920, height: 1080 })
  await HumanNavigator.simulateBrowsing(page)

  for (const strategy of strategies) {
    const strategyName = strategy.constructor.name
    logger.info(chalk.yellow(`  - Executing ${strategyName}...`))

    const isSolved = await strategy.solve(page)
    if (isSolved) {
      logger.success(`${chalk.bold.green('[BYPASS SUCCESS]')} Challenge resolved via ${strategyName}!\n`)
      return false
    }

    logger.warn(`  - ${strategyName} failed to resolve challenge. Trying next...`)
  }

  logger.error(`${chalk.bold.red('[BYPASS FAILED]')} All strategies exhausted. Failing fast.\n`)
  throw new CloudflareBypassError('Cloudflare bypass exhausted all strategies. Failing fast.')
}
