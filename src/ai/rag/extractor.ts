import { type OllamaClient } from '../ollama-client.js'
import { type VectorSearchResult } from '../../search/vector-store.js'
import { type ExtractedFact } from './types.js'
import { RAG_PROMPTS } from './prompts.js'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'
import jsonic from 'jsonic'

export class FactExtractor {
  constructor(private readonly ollamaClient: OllamaClient) {}

  async extractFacts(
    userQuestion: string,
    searchResults: VectorSearchResult[],
    isExhaustiveStrategy: boolean
  ): Promise<ExtractedFact[]> {
    const MAXIMUM_NODES_FOR_EXHAUSTIVE = 60
    const MAXIMUM_NODES_FOR_PRECISE = 35
    const poolSizeLimit = isExhaustiveStrategy ? MAXIMUM_NODES_FOR_EXHAUSTIVE : MAXIMUM_NODES_FOR_PRECISE

    const candidateNodesPool = searchResults.slice(0, poolSizeLimit)
    if (candidateNodesPool.length === 0) return []

    const extractedResearchFindings: ExtractedFact[] = []
    const ANALYSIS_BATCH_SIZE = 10
    const totalBatchesToProcess = Math.ceil(candidateNodesPool.length / ANALYSIS_BATCH_SIZE)

    for (let currentBatchOffset = 0; currentBatchOffset < candidateNodesPool.length; currentBatchOffset += ANALYSIS_BATCH_SIZE) {
      const currentBatchNumber = Math.floor(currentBatchOffset / ANALYSIS_BATCH_SIZE) + 1
      const currentResultsBatch = candidateNodesPool.slice(currentBatchOffset, currentBatchOffset + ANALYSIS_BATCH_SIZE)

      logger.info(`Analyzing history snippets... batch ${currentBatchNumber} of ${totalBatchesToProcess}`)

      const batchContextText = currentResultsBatch
        .map((result, indexWithinBatch) => `[Node ${currentBatchOffset + indexWithinBatch}] ${result.meta['title']}: ${result.meta['snippet']}`)
        .join('\n\n')

      const researcherPrompt = RAG_PROMPTS.informationResearcher(userQuestion, batchContextText)

      try {
        const ollamaResponseText = await this.ollamaClient.generate(researcherPrompt)
        const extractedFactsList = this.extractJsonArrayFromResponse(ollamaResponseText)

        for (const factEntry of extractedFactsList) {
          const originalSourceNode = candidateNodesPool[factEntry.node_id]
          extractedResearchFindings.push({
            factContent: factEntry.fact,
            sourceDocumentTitle: originalSourceNode?.meta['title'] || factEntry.thread || 'Unknown',
            conversationThreadTitle: factEntry.thread || originalSourceNode?.meta['title'] || 'Unknown',
          })
        }
      } catch (extractionError) {
        errorBus.emitError(`Fact extraction batch ${currentBatchNumber} failed`, extractionError)
        for (const fallbackResult of currentResultsBatch) {
          extractedResearchFindings.push({
            factContent: fallbackResult.meta['snippet'] as string,
            sourceDocumentTitle: fallbackResult.meta['title'] as string,
            conversationThreadTitle: fallbackResult.meta['title'] as string,
          })
        }
      }
    }

    return extractedResearchFindings
  }

  private extractJsonArrayFromResponse(responseText: string): any[] {
    const jsonBlockRegex = /(\{[\s\S]*\}|\[[\s\S]*\])/
    const regexMatchResult = responseText.match(jsonBlockRegex)

    if (regexMatchResult?.[0]) {
      try {
        const parsedData = jsonic(regexMatchResult[0])
        return Array.isArray(parsedData) ? parsedData : []
      } catch (parsingError) {
        errorBus.emitError('Failed to parse researcher JSON', parsingError, { response: responseText })
        return []
      }
    }
    return []
  }
}
