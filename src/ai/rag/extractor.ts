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
    question: string,
    results: VectorSearchResult[],
    isExhaustive: boolean
  ): Promise<ExtractedFact[]> {
    const poolLimit = isExhaustive ? 60 : 35
    const processingPool = results.slice(0, poolLimit)
    if (processingPool.length === 0) return []

    const extractedFindings: ExtractedFact[] = []
    const ANALYSIS_BATCH_SIZE = 10
    const totalBatches = Math.ceil(processingPool.length / ANALYSIS_BATCH_SIZE)

    for (let i = 0; i < processingPool.length; i += ANALYSIS_BATCH_SIZE) {
      const batchNumber = Math.floor(i / ANALYSIS_BATCH_SIZE) + 1
      const currentBatch = processingPool.slice(i, i + ANALYSIS_BATCH_SIZE)
      logger.info(`Analyzing history snippets... batch ${batchNumber} of ${totalBatches}`)

      const contextText = currentBatch
        .map((res, index) => `[Node ${i + index}] ${res.meta['title']}: ${res.meta['snippet']}`)
        .join('\n\n')

      const prompt = RAG_PROMPTS.researcher(question, contextText)

      try {
        const response = await this.ollamaClient.generate(prompt)
        const extractedFacts = this.parseJson(response)

        for (const factEntry of extractedFacts) {
          const originalSnippet = processingPool[factEntry.node_id]
          extractedFindings.push({
            fact: factEntry.fact,
            source_title: originalSnippet?.meta['title'] || factEntry.thread || 'Unknown',
            thread: factEntry.thread || originalSnippet?.meta['title'] || 'Unknown',
          })
        }
      } catch (e) {
        errorBus.emitError(`Fact extraction batch ${batchNumber} failed`, e)
        for (const res of currentBatch) {
          extractedFindings.push({
            fact: res.meta['snippet'] as string,
            source_title: res.meta['title'] as string,
            thread: res.meta['title'] as string,
          })
        }
      }
    }

    return extractedFindings
  }

  private parseJson(response: string): any[] {
    const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (jsonMatch?.[0]) {
      try {
        const parsed = jsonic(jsonMatch[0])
        return Array.isArray(parsed) ? parsed : []
      } catch (e) {
        errorBus.emitError('Failed to parse researcher JSON', e, { response })
        return []
      }
    }
    return []
  }
}
