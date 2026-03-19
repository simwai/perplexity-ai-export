import { beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from 'patchright'

let sharedBrowserInstance: Browser

beforeAll(async () => {
  try {
    sharedBrowserInstance = await chromium.launch({ headless: true })
  } catch (_error) {
    console.warn('Could not launch browser in setup.ts, some tests might fail if they require it.')
  }
})

afterAll(async () => {
  if (sharedBrowserInstance) {
    await sharedBrowserInstance.close()
  }
})

export { sharedBrowserInstance as browser }
