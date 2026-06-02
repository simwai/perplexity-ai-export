import { z } from 'zod'
import { createHash } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import { type ApiDiagnosticsWriter } from '../../utils/api-diagnostics.js'
import { errorBus } from '../../utils/error-bus.js'

export class DataParser {
  private static readonly ConversationEntrySchema = z.object({
    uuid: z.string().optional(),
    query_str: z.string().nullable().optional(),
    thread_title: z.string().nullable().optional(),
    blocks: z.array(z.any()).optional(),
    updated_datetime: z.string().optional(),
    collection_info: z.object({ title: z.string().optional() }).optional().nullable(),
  })

  constructor(private readonly apiDiagnosticsWriter: ApiDiagnosticsWriter) {}

  parse(rawApiData: any, conversationUrl: string): { entries: any[], meta: any, hash: string } | null {
    const normalizedEntries = this.normalizeApiData(rawApiData, conversationUrl)
    const validationResult = z.array(DataParser.ConversationEntrySchema).nonempty().safeParse(normalizedEntries)

    if (!validationResult.success) {
      const areEntriesEmpty = normalizedEntries.length === 0
      if (areEntriesEmpty) {
        this.apiDiagnosticsWriter.writeFailure({ url: conversationUrl, errorType: 'empty_entries' }).catch(() => {})
      }
      errorBus.emitError(`Entry validation failed for ${conversationUrl}`, validationResult.error)
      return null
    }

    const validatedEntries = validationResult.data
    const firstEntryInConversation = validatedEntries[0]!
    const contentIntegrityHash = createHash('sha256').update(stringify(validatedEntries)).digest('hex')

    const conversationIdentifierMatch = conversationUrl.match(/\/search\/([^/?]+)/)
    const conversationId = conversationIdentifierMatch?.[1] ?? 'unknown'

    return {
      entries: validatedEntries,
      hash: contentIntegrityHash,
      meta: {
        id: conversationId,
        title: firstEntryInConversation.thread_title ?? rawApiData?.thread_title ?? 'Untitled',
        spaceName: firstEntryInConversation.collection_info?.title ?? rawApiData?.collection_info?.title ?? 'General',
        timestamp: new Date(firstEntryInConversation.updated_datetime ?? rawApiData?.updated_datetime ?? new Date())
      }
    }
  }

  private normalizeApiData(rawApiData: any, conversationUrl: string): any[] {
    const isAlreadyAnArray = Array.isArray(rawApiData)
    if (isAlreadyAnArray) return rawApiData

    const hasEntriesProperty = rawApiData?.entries && Array.isArray(rawApiData.entries)
    if (hasEntriesProperty) return rawApiData.entries

    const isSingleEntryObject = rawApiData?.query_str || rawApiData?.blocks
    if (isSingleEntryObject) return [rawApiData]

    this.apiDiagnosticsWriter.writeFailure({ url: conversationUrl, errorType: 'unknown_shape' }).catch(() => {})
    return []
  }
}
