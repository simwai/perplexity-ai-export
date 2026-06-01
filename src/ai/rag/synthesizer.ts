import { type OllamaClient } from '../ollama-client.js'
import { type ExtractedFact } from './types.js'
import { RAG_PROMPTS } from './prompts.js'
import jsonic from 'jsonic'

export class ResponseSynthesizer {
  constructor(private readonly ollamaClient: OllamaClient) {}

  async synthesize(question: string, facts: ExtractedFact[], strategy: string): Promise<string> {
    const findingsText = facts
      .map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`)
      .join('\n')

    const prompt = RAG_PROMPTS.narrator(question, strategy, findingsText)
    return this.ollamaClient.generate(prompt)
  }

  async verifyQuality(question: string, answer: string): Promise<{ status: string; suggestion?: string }> {
    const prompt = RAG_PROMPTS.verifier(question, answer)
    try {
      const response = await this.ollamaClient.generate(prompt)
      const parsed = this.parseJson(response)
      return {
        status: parsed.status || 'ok',
        suggestion: parsed.suggestion
      }
    } catch {
      return { status: 'ok' }
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
