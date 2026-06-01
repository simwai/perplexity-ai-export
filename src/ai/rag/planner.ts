import { type OllamaClient } from '../ollama-client.js'
import { type ResearchPlan } from './types.js'
import { RAG_PROMPTS } from './prompts.js'
import jsonic from 'jsonic'

export class RAGPlanner {
  constructor(private readonly ollamaClient: OllamaClient) {}

  async developPlan(question: string): Promise<ResearchPlan> {
    const prompt = RAG_PROMPTS.planner(question)
    try {
      const response = await this.ollamaClient.generate(prompt)
      const planJson = this.parseJson(response)

      return {
        strategy: planJson.strategy || 'precise',
        queries: planJson.queries || [question],
        hardKeywords: planJson.hardKeywords || [],
        hydePassage: planJson.hydePassage || '',
        filters: planJson.filters || {},
      }
    } catch {
      return {
        strategy: 'precise',
        queries: [question],
        hardKeywords: [],
        hydePassage: '',
        filters: {},
      }
    }
  }

  private parseJson(response: string): any {
    const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (jsonMatch?.[0]) {
      try {
        return jsonic(jsonMatch[0])
      } catch {
        return {}
      }
    }
    return {}
  }
}
