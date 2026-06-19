import { type OllamaClient } from '../ollama-client.js'
import { type ExtractedFact } from './types.js'
import { RAG_PROMPTS } from './prompts.js'
import { errorBus } from '../../utils/error-bus.js'
import jsonic from 'jsonic'

export class ResponseSynthesizer {
  constructor(private readonly ollamaClient: OllamaClient) {}

  async synthesize(
    userQuestion: string,
    researchFacts: ExtractedFact[],
    researchStrategy: string
  ): Promise<string> {
    try {
      const researchFindingsSummaryText = researchFacts
        .map((fact, index) => `[Find ${index}] (${fact.sourceDocumentTitle}): ${fact.factContent}`)
        .join('\n')

      const narratorPrompt = RAG_PROMPTS.answerNarrator(
        userQuestion,
        researchStrategy,
        researchFindingsSummaryText
      )
      return await this.ollamaClient.generate(narratorPrompt)
    } catch (synthesisError) {
      return errorBus.raiseError('Response synthesis failed', synthesisError)
    }
  }

  async verifyQuality(
    userQuestion: string,
    generatedAnswer: string
  ): Promise<{ verificationStatus: string; improvementSuggestion?: string }> {
    const verifierPrompt = RAG_PROMPTS.answerVerifier(userQuestion, generatedAnswer)
    try {
      const ollamaResponseText = await this.ollamaClient.generate(verifierPrompt)
      const parsedVerificationJson = this.extractJsonFromResponse(ollamaResponseText)
      return {
        verificationStatus: parsedVerificationJson.status || 'ok',
        improvementSuggestion: parsedVerificationJson.suggestion,
      }
    } catch (verificationError) {
      errorBus.emitError('Answer verification failed', verificationError)
      return { verificationStatus: 'ok' }
    }
  }

  private extractJsonFromResponse(responseText: string): any {
    const jsonBlockRegex = /(\{[\s\S]*\}|\[[\s\S]*\])/
    const regexMatchResult = responseText.match(jsonBlockRegex)

    if (regexMatchResult?.[0]) {
      try {
        return jsonic(regexMatchResult[0])
      } catch (parsingError) {
        errorBus.emitError('Failed to parse verifier JSON', parsingError, {
          response: responseText,
        })
        return {}
      }
    }
    return {}
  }
}
