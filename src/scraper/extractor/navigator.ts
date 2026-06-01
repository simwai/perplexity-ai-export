import { type Page, type Response } from 'patchright'
import { NavigationError, NotFoundError, AuthError, ServerError } from './errors.js'

export class PageNavigator {
  async navigateTo(page: Page, url: string): Promise<void> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    this.validate(response)
  }

  private validate(response: Response | null): void {
    if (!response) throw new NavigationError('Navigation failed - no response')
    const status = response.status()
    if (status === 404) throw new NotFoundError('Conversation not found (404)')
    if (status === 403 || status === 401) throw new AuthError('Auth required or expired')
    if (status >= 500) throw new ServerError(`Server error (${status})`)
    if (status >= 400) throw new NavigationError(`HTTP error ${status}`)
  }
}
