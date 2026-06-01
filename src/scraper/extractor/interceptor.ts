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

  constructor(private readonly diagnostics: ApiDiagnosticsWriter) {}

  async capture(page: Page, timeoutMs: number): Promise<unknown | null> {
    const accumulated: any[] = []
    let resolved = false

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(accumulated.length > 0 ? { entries: accumulated } : null)
        }
      }, timeoutMs)

      page.on('response', async (res) => {
        if (resolved || page.isClosed()) return
        const url = res.url()
        if (!url.includes('/rest/thread/') || url.includes('list_')) return

        try {
          const json = await res.json()
          const parsed = ApiInterceptor.ApiResponseSchema.safeParse(json)
          if (!parsed.success) {
            await this.diagnostics.writeFailure({
              url: res.url(),
              errorType: 'zod_error',
              zodErrorPaths: parsed.error.issues.map(i => i.path.join('.'))
            })
          } else {
            const data = parsed.data as any
            accumulated.push(...(Array.isArray(data) ? data : data.entries))
            if (Array.isArray(data) || !data.collection_info?.has_next_page) {
              clearTimeout(timer)
              resolved = true
              resolve({ entries: accumulated })
            }
          }
        } catch {}
      })
    })
  }
}
