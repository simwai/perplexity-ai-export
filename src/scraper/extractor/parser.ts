import { z } from 'zod'
import { createHash } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import { type ApiDiagnosticsWriter } from '../../utils/api-diagnostics.js'
import { errorBus } from '../../utils/error-bus.js'

export class DataParser {
  private static readonly EntrySchema = z.object({
    uuid: z.string().optional(),
    query_str: z.string().nullable().optional(),
    thread_title: z.string().nullable().optional(),
    blocks: z.array(z.any()).optional(),
    updated_datetime: z.string().optional(),
    collection_info: z.object({ title: z.string().optional() }).optional().nullable(),
  })

  constructor(private readonly diagnostics: ApiDiagnosticsWriter) {}

  parse(apiData: any, url: string): { entries: any[], meta: any, hash: string } | null {
    const rawEntries = this.normalize(apiData, url)
    const result = z.array(DataParser.EntrySchema).nonempty().safeParse(rawEntries)

    if (!result.success) {
      if (rawEntries.length === 0) {
        this.diagnostics.writeFailure({ url, errorType: 'empty_entries' }).catch(() => {})
      }
      errorBus.emitError(`Entry validation failed for ${url}`, result.error)
      return null
    }

    const entries = result.data
    const first = entries[0]!
    const hash = createHash('sha256').update(stringify(entries)).digest('hex')

    return {
      entries,
      hash,
      meta: {
        id: url.match(/\/search\/([^/?]+)/)?.[1] ?? 'unknown',
        title: first.thread_title ?? apiData?.thread_title ?? 'Untitled',
        spaceName: first.collection_info?.title ?? apiData?.collection_info?.title ?? 'General',
        timestamp: new Date(first.updated_datetime ?? apiData?.updated_datetime ?? new Date())
      }
    }
  }

  private normalize(data: any, url: string): any[] {
    if (Array.isArray(data)) return data
    if (data?.entries && Array.isArray(data.entries)) return data.entries
    if (data?.query_str || data?.blocks) return [data]
    this.diagnostics.writeFailure({ url, errorType: 'unknown_shape' }).catch(() => {})
    return []
  }
}
