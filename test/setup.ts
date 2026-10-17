import { beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from '@playwright/test'

let sharedBrowserInstance: Browser

beforeAll(async () => {
  try {
    sharedBrowserInstance = await chromium.launch({ headless: true })
  } catch (_error) {
    console.warn('Could not launch browser in setup.ts, some tests might fail if they require it.')
  }
}, 30_000)

afterAll(async () => {
  if (sharedBrowserInstance) {
    try {
      await Promise.race([
        sharedBrowserInstance.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timeout')), 10_000)
        ),
      ])
    } catch (error) {
      console.warn(
        'Browser cleanup failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}, 15_000)

export { sharedBrowserInstance as browser }
