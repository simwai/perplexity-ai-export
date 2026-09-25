import { AiClient } from './ai-client.js'
import { logger } from '../utils/logging/logger.js'
import { type ExtractedFact } from './rag-types.js'

export class RagSynthesizer {
  constructor(private readonly aiClient: AiClient) {}

  async generateMightiestResponse(
    question: string,
    extractedFacts: ExtractedFact[],
    strategy: string
  ): Promise<string> {
    if (extractedFacts.length === 0) {
      return 'No relevant information found in your history for this question.'
    }
    const synthesisPrompt = `
You are the Narrator. Synthesize these research findings into a cohesive answer for: "${question}"
Strategy: ${strategy}
Findings:
${extractedFacts.map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`).join('\n')}

INSTRUCTIONS:
1. Only use findings that are DIRECTLY relevant to the question.
2. If a finding is irrelevant, do not cite it and do not mention it.
3. Be specific with names and technical details from the findings.
4. Cite relevant findings using the source title in brackets, e.g., [which big python projects use pdm...].
5. If no findings are relevant, say "No relevant information found in your history."

ANSWER:
`
    const response = await this.aiClient.generate(synthesisPrompt)
    return response.ok ? response.value : 'Failed to generate answer.'
  }

  displaySourceProvenance(extractedFacts: ExtractedFact[]): void {
    if (extractedFacts.length === 0) return

    logger.info('\nHistory Sources Explored:')
    for (let index = 0; index < extractedFacts.length; index++) {
      const fact = extractedFacts[index]!
      const shortTitle =
        fact.source_title.length > 60 ? fact.source_title.slice(0, 57) + '...' : fact.source_title
      logger.info(`  [Find ${index}] ${shortTitle}`)
      if (fact.fact.length > 120) {
        logger.info(`      ${fact.fact.slice(0, 117)}...`)
      } else {
        logger.info(`      ${fact.fact}`)
      }
    }
  }
}
