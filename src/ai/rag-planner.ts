import { AiClient, type ChatMessage } from './ai-client.js'
import { logger } from '../utils/logging/logger.js'
import { type Config } from '../utils/config.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { from } from 'super-result'
import { ApiDiagnosticsWriter, zodErrorPaths } from '../utils/logging/api-diagnostics.js'
import {
  researchPlanJsonSchema,
  verificationResultSchema,
  type ResearchPlan,
  type ExtractedFact,
} from './rag-types.js'

export class RagPlanner {
  constructor(
    private readonly config: Config,
    private readonly aiClient: AiClient,
    private readonly diagnosticsWriter: ApiDiagnosticsWriter
  ) {}

  parseJsonWithSchema<T>(
    response: string,
    schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { message: string } } },
    defaultValue: T,
    context: string
  ): T {
    const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!jsonMatch?.[0]) return defaultValue
    const parseResult = from(() => JSON.parse(jsonMatch[0]!))
    if (!parseResult.ok) {
      logger.debug(`JSON parse failed`)
      return defaultValue
    }
    const schemaResult = schema.safeParse(parseResult.value)
    if (!schemaResult.success) {
      logger.debug(`Schema validation failed: ${schemaResult.error?.message ?? ''}`)
      const paths = zodErrorPaths(schemaResult as any)
      this.diagnosticsWriter.writeFailure({
        url: `rag://${context}`,
        errorType: 'zod_error',
        zodErrorPaths: paths,
      })
    }
    return schemaResult.success && schemaResult.data !== undefined
      ? schemaResult.data
      : defaultValue
  }

  async rephraseQuestionWithHistory(
    question: string,
    history: ChatMessage[]
  ): Promise<string> {
    const isHistoryEmpty = history.length === 0
    if (isHistoryEmpty) return question

    const rephrasePrompt = `
Given the following conversation history and a new question, rephrase the new question to be a standalone question that can be used for search.
If the new question is already standalone, return it as is.

History:
${history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

New Question: ${question}

Standalone Question:
`
    const response = await this.aiClient.generate(rephrasePrompt)
    return response.ok ? response.value.trim() || question : question
  }

  buildChatSystemPrompt(extractedFacts: ExtractedFact[]): string {
    if (extractedFacts.length === 0) {
      return `You are a helpful assistant answering questions based on the user's exported conversation history.
No relevant findings were retrieved for this question. Inform the user that no relevant information was found in their history, but still try to be helpful with general knowledge if appropriate.`
    }

    const findings = extractedFacts
      .map((fact, index) => `[Find ${index}] (${fact.source_title}): ${fact.fact}`)
      .join('\n')

    return `
You are a helpful assistant answering questions based on the user's exported conversation history.
Use the following research findings to provide an authoritative and specific response.

Findings:
${findings}

INSTRUCTIONS:
1. Provide a cohesive and helpful answer using only findings that directly answer the question.
2. Cite findings by source title in brackets, e.g., [which big python projects use pdm...], matching the History Sources Explored list.
3. If the history doesn't contain relevant information, inform the user but still try to be helpful based on general knowledge if it's a follow-up.
`
  }

  async developResearchPlan(originalQuestion: string): Promise<ResearchPlan> {
    const isHydeInPlanner = this.config.hydeMode === 'fusion'
    const hydeInstruction = isHydeInPlanner
      ? "4. HyDE: Write 1-2 sentences that would plausibly appear in a saved answer to this question. Write as if it's content already stored, not as a reply."
      : ''

    const jsonTemplate = isHydeInPlanner
      ? '{"strategy": "...", "queries": [], "hardKeywords": [], "hydePassage": "..."}'
      : '{"strategy": "...", "queries": [], "hardKeywords": []}'

    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
${hydeInstruction}
Return JSON: ${jsonTemplate}
`
    const generateResult = await this.aiClient.generate(plannerPrompt)

    if (!generateResult.ok) {
      logger.debug(`Research plan generation failed: ${errorMessageOf(generateResult.error)}`)
      return {
        strategy: 'precise',
        originalQuestion,
        queries: [originalQuestion],
        hardKeywords: [],
        hydePassage: '',
      }
    }

    const planJson = this.parseJsonWithSchema(
      generateResult.value,
      researchPlanJsonSchema,
      {},
      'research-plan'
    )

    return {
      originalQuestion,
      strategy: planJson.strategy || 'precise',
      queries:
        planJson.queries && planJson.queries.length > 0 ? planJson.queries : [originalQuestion],
      hardKeywords: planJson.hardKeywords || [],
      hydePassage: planJson.hydePassage || '',
    }
  }

  async generateHydePassage(question: string): Promise<string> {
    const hydePrompt = `
Write 1-2 sentences that would plausibly appear in a saved answer to the question: "${question}"
Write as if it's content already stored in a document, not as a direct reply.
`
    const response = await this.aiClient.generate(hydePrompt)
    return response.ok ? response.value : ''
  }

  async verifyAnswerQuality(
    question: string,
    answer: string
  ): Promise<{ status: string; suggestion?: string }> {
    const verificationPrompt = `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
    const verifyResponse = await this.aiClient.generate(verificationPrompt)
    return this.parseJsonWithSchema(
      verifyResponse.ok ? verifyResponse.value : '',
      verificationResultSchema,
      { status: 'ok' },
      'verification'
    )
  }
}
