import { type Page, type Response } from 'patchright'
import { errorBus } from '../../utils/error-bus.js'

export class PageNavigator {
  async navigateTo(page: Page, url: string): Promise<void> {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      this.validate(response)
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        errorBus.raiseError(`Navigation timeout for ${url}`, e)
      }
      throw e
    }
  }

  private validate(response: Response | null): void {
    if (!response) {
      errorBus.raiseError('Navigation failed - no response')
      return
    }
    const status = response.status()
    if (status === 404) errorBus.raiseError('Conversation not found (404)')
    if (status === 403 || status === 401) errorBus.raiseError('Auth required or expired')
    if (status >= 500) errorBus.raiseError(`Server error (${status})`)
    if (status >= 400) errorBus.raiseError(`HTTP error ${status}`)
  }
}
