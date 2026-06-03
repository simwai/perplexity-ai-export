import { beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from 'patchright'

let sharedBrowserInstance: Browser

beforeAll(async () => {
  try {
    sharedBrowserInstance = await chromium.launch({ headless: true })
  } catch (launchError) {
    // Suppress errors here; individual tests should handle missing browsers or attempt launch
  }
})

afterAll(async () => {
  if (sharedBrowserInstance) {
    await sharedBrowserInstance.close()
  }
})

export { sharedBrowserInstance as browser }
