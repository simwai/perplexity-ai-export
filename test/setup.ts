import { beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from '@playwright/test'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

export { browser }
