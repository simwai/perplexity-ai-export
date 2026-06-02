import { type OllamaClient } from '../ollama-client.js'
import { type ResearchPlan } from './types.js'
import { RAG_PROMPTS } from './prompts.js'
import { errorBus } from '../../utils/error-bus.js'
import jsonic from 'jsonic'

export class RAGPlanner {
  constructor(private readonly ollamaClient: OllamaClient) {}

  async developPlan(userQuestion: string): Promise<ResearchPlan> {
    const researchPlannerPrompt = RAG_PROMPTS.researchPlanner(userQuestion)
    try {
      const ollamaResponseText = await this.ollamaClient.generate(researchPlannerPrompt)
      const parsedPlanJson = this.extractJsonFromResponse(ollamaResponseText)

      return {
        researchStrategy: parsedPlanJson.strategy || 'precise',
        searchQueries: parsedPlanJson.queries || [userQuestion],
        hardKeywordsForExactMatch: parsedPlanJson.hardKeywords || [],
        hypotheticalDocumentEmbeddingsPassage: parsedPlanJson.hydePassage || '',
        metadataFilters: parsedPlanJson.filters || {},
      }
    } catch (planningError) {
      errorBus.emitError('Research planner fallback triggered', planningError)
      return {
        researchStrategy: 'precise',
        searchQueries: [userQuestion],
        hardKeywordsForExactMatch: [],
        hypotheticalDocumentEmbeddingsPassage: '',
        metadataFilters: {},
      }
    }
  }

  private extractJsonFromResponse(responseText: string): any {
    const jsonBlockRegex = /(\{[\s\S]*\}|\[[\s\S]*\])/
    const regexMatchResult = responseText.match(jsonBlockRegex)

    if (regexMatchResult?.[0]) {
      try {
        return jsonic(regexMatchResult[0])
      } catch (parsingError) {
        errorBus.emitError('Failed to parse planner JSON', parsingError, { response: responseText })
        return {}
      }
    }
    return {}
  }
}
