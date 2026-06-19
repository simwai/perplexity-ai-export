import { type Page, type Response } from 'patchright'
import { errorBus } from '../../utils/error-bus.js'

export class PageNavigator {
  async navigateTo(webPage: Page, targetUrl: string): Promise<void> {
    try {
      const navigationResponse = await webPage.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      this.validateResponse(navigationResponse)
    } catch (navigationError) {
      const isTimeoutError =
        navigationError instanceof Error && navigationError.name === 'TimeoutError'
      if (isTimeoutError) {
        errorBus.raiseError(`Navigation timeout for ${targetUrl}`, navigationError)
      }
      throw navigationError
    }
  }

  private validateResponse(navigationResponse: Response | null): void {
    if (!navigationResponse) {
      errorBus.raiseError('Navigation failed - no response')
      return
    }

    const httpStatusCode = navigationResponse.status()
    if (httpStatusCode === 404) errorBus.raiseError('Conversation not found (404)')
    if (httpStatusCode === 403 || httpStatusCode === 401)
      errorBus.raiseError('Auth required or expired')
    if (httpStatusCode >= 500) errorBus.raiseError(`Server error (${httpStatusCode})`)
    if (httpStatusCode >= 400) errorBus.raiseError(`HTTP error ${httpStatusCode}`)
  }
}
