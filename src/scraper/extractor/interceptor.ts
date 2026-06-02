import { type Page } from 'patchright'
import { z } from 'zod'
import { type ApiDiagnosticsWriter } from '../../utils/api-diagnostics.js'

export class ApiInterceptor {
  private static readonly ApiResponseSchema = z.union([
    z.array(z.any()),
    z.object({
      entries: z.array(z.any()),
      collection_info: z.object({ has_next_page: z.boolean().optional() }).optional(),
    }),
  ])

  constructor(private readonly apiDiagnosticsWriter: ApiDiagnosticsWriter) {}

  async capture(webPage: Page, captureTimeoutMilliseconds: number): Promise<unknown | null> {
    const accumulatedApiEntries: any[] = []
    let isRequestResolved = false

    return new Promise((resolve) => {
      const timeoutTimerIdentifier = setTimeout(() => {
        if (!isRequestResolved) {
          isRequestResolved = true
          resolve(accumulatedApiEntries.length > 0 ? { entries: accumulatedApiEntries } : null)
        }
      }, captureTimeoutMilliseconds)

      webPage.on('response', async (webResponse) => {
        if (isRequestResolved || webPage.isClosed()) {
          return
        }

        const responseUrl = webResponse.url()
        const isThreadApiRequest = responseUrl.includes('/rest/thread/')
        const isExcludedListRequest = responseUrl.includes('list_')

        if (!isThreadApiRequest || isExcludedListRequest) {
          return
        }

        try {
          const jsonResponseData = await webResponse.json()
          const validationResult = ApiInterceptor.ApiResponseSchema.safeParse(jsonResponseData)

          if (!validationResult.success) {
            await this.apiDiagnosticsWriter.writeFailure({
              url: webResponse.url(),
              errorType: 'zod_error',
              zodErrorPaths: validationResult.error.issues.map(issue => issue.path.join('.'))
            })
          } else {
            const validatedData: any = validationResult.data
            const newEntriesToAppend = Array.isArray(validatedData) ? validatedData : validatedData.entries
            accumulatedApiEntries.push(...newEntriesToAppend)

            const hasMorePagesToCapture = !Array.isArray(validatedData) && validatedData.collection_info?.has_next_page
            if (!hasMorePagesToCapture) {
              clearTimeout(timeoutTimerIdentifier)
              isRequestResolved = true
              resolve({ entries: accumulatedApiEntries })
            }
          }
        } catch (jsonParsingError) {
          // Ignore responses that are not valid JSON
        }
      })
    })
  }
}
