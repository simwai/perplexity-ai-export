import { VectorSearchResult } from '../search/vector-store.js'
import { AiClient } from './ai-client.js'
import { logger } from '../utils/logging/logger.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createResult, ok, err, from } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/logging/api-diagnostics.js'
import {
  extractedFactSchema,
  type ExtractedFact,
  OrchestratorError,
} from './rag-types.js'

const ANALYSIS_BATCH_SIZE = 10

export class RagExtractor {
  private readonly resultFactory = createResult<OrchestratorError>((error: unknown) =>
    error instanceof OrchestratorError ? error : new OrchestratorError(String(error))
  )

  constructor(
    private readonly aiClient: AiClient,
    private readonly diagnosticsWriter: ApiDiagnosticsWriter
  ) {}

  async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    isExhaustive: boolean
  ): Promise<ExtractedFact[]> {
    const POOL_LIMIT_EXHAUSTIVE = 80
    const POOL_LIMIT_PRECISE = 50
    const poolLimit = isExhaustive ? POOL_LIMIT_EXHAUSTIVE : POOL_LIMIT_PRECISE

    const processingPool = results.slice(0, poolLimit)
    const isPoolEmpty = processingPool.length === 0
    if (isPoolEmpty) return []

    const extractedFindings: ExtractedFact[] = []
    const totalBatches = Math.ceil(processingPool.length / ANALYSIS_BATCH_SIZE)

    for (
      let batchStartIndex = 0, batchNumber = 1;
      batchStartIndex < processingPool.length;
      batchStartIndex += ANALYSIS_BATCH_SIZE, batchNumber++
    ) {
      const currentBatch = processingPool.slice(
        batchStartIndex,
        batchStartIndex + ANALYSIS_BATCH_SIZE
      )
      logger.info(`Analyzing history snippets... batch ${batchNumber} of ${totalBatches}`)

      const researchPrompt = `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${currentBatch.map((res, index) => `[Node ${batchStartIndex + index}] ${res.meta['title']}: ${res.meta['snippet']}`).join('\n\n')}

Extract facts that answer the question. Prefer facts from DIFFERENT sources (titles) to maximize coverage.
Return JSON array: [{"fact": "...", "node_id": N}]
- fact: a specific claim, code, date, or detail that answers the question
- node_id: the Node index from Context above (0-based)
- Do NOT include a "thread" field - it will be filled from the source title
- Limit: at most 1 fact per unique source title in this batch
`
      const response = await this.aiClient.generate(researchPrompt)
      if (!response.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(response.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }
      const jsonMatch = response.value.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        const parseErrorResult = err(new OrchestratorError('No JSON array found in response'))
        if (!parseErrorResult.ok) {
          logger.warn(
            `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseErrorResult.error)}`
          )
          for (const res of currentBatch) {
            extractedFindings.push({
              fact: res.meta['snippet'] ?? '',
              source_title: res.meta['title'] ?? '',
              thread: res.meta['title'] ?? '',
            })
          }
          continue
        }
      }
      const jsonText = (jsonMatch as RegExpMatchArray)[0]
      if (!jsonText) {
        const parseErrorResult = err(new OrchestratorError('No JSON array found in response'))
        if (!parseErrorResult.ok) {
          logger.warn(
            `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseErrorResult.error)}`
          )
          for (const res of currentBatch) {
            extractedFindings.push({
              fact: res.meta['snippet'] ?? '',
              source_title: res.meta['title'] ?? '',
              thread: res.meta['title'] ?? '',
            })
          }
          continue
        }
      }
      const parseResult = await this.resultFactory.from(() => JSON.parse(jsonText))
      if (!parseResult.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(parseResult.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }
      const parsedJson = parseResult.value
      const arrayCheckResult = !Array.isArray(parsedJson)
        ? err(new OrchestratorError('Response is not a JSON array'))
        : ok(undefined)
      if (!arrayCheckResult.ok) {
        logger.warn(
          `Fact extraction batch ${batchNumber}/${totalBatches} failed for question "${question}": ${errorMessageOf(arrayCheckResult.error)}`
        )
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] ?? '',
            source_title: res.meta['title'] ?? '',
            thread: res.meta['title'] ?? '',
          })
        }
        continue
      }

      for (const factEntry of parsedJson) {
        const validated = extractedFactSchema.safeParse(factEntry)
        if (!validated.success) {
          logger.debug(`Skipping invalid fact entry: ${validated.error.message}`)
          const paths = zodErrorPaths(validated)
          this.diagnosticsWriter.writeFailure({
            url: 'rag://extract-facts',
            errorType: 'zod_error',
            zodErrorPaths: paths,
          })
          continue
        }
        const factData = validated.data
        if (factData.node_id >= processingPool.length) {
          logger.debug(
            `Skipping out-of-range node_id: ${factData.node_id} (pool size ${processingPool.length})`
          )
          continue
        }
        const originalSnippet = processingPool[factData.node_id]
        const sourceTitle = originalSnippet?.meta['title'] || 'Unknown'
        extractedFindings.push({
          fact: factData.fact,
          source_title: sourceTitle,
          thread: sourceTitle,
        })
      }
    }

    return this.filterRelevantFacts(question, extractedFindings)
  }

  async filterRelevantFacts(
    question: string,
    facts: ExtractedFact[]
  ): Promise<ExtractedFact[]> {
    if (facts.length === 0) return []

    const filterPrompt = `
Question: "${question}"
Facts:
${facts.map((f, i) => `${i}: ${f.fact} (source: ${f.source_title})`).join('\n')}

For each fact, is it related to the question? Mark relevant=true if the fact contains information that could be relevant context for answering the question.
Return JSON array: [{"index": 0, "relevant": true}, {"index": 1, "relevant": false}, ...]
`
    const filterResponse = await this.aiClient.generate(filterPrompt)
    if (!filterResponse || !filterResponse.ok) {
      logger.warn(
        `Relevance filter failed for question "${question}": ${filterResponse ? errorMessageOf(filterResponse.error) : 'no response'}`
      )
      return facts
    }
    const jsonMatch = filterResponse.value.match(/\[[\s\S]*\]/)
    if (!jsonMatch?.[0]) return facts
    const parseResult = from(() => JSON.parse(jsonMatch[0]!))
    if (!parseResult.ok) return facts
    const parsed: Array<{ index: number; relevant: boolean }> = parseResult.value
    const relevantIndices = new Set(parsed.filter((p) => p.relevant).map((p) => p.index))
    let filtered = facts.filter((_, i) => relevantIndices.has(i))

    if (filtered.length === 0) {
      logger.debug(`Filtered ${facts.length} -> 0, relaxing to keep all`)
      filtered = facts
    }

    const seenSources = new Set<string>()
    const deduped: ExtractedFact[] = []
    for (const fact of filtered) {
      const key = fact.source_title.toLowerCase().trim()
      if (!seenSources.has(key)) {
        seenSources.add(key)
        deduped.push(fact)
      }
    }

    if (deduped.length !== filtered.length) {
      logger.debug(`Deduplicated ${filtered.length} -> ${deduped.length} unique sources`)
    }

    return deduped
  }
}
