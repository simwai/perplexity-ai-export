import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { AiClient, type ChatMessage, type LlmResponse } from './ai-client.js'
import { RipgrepSearch } from '../search/rg-search.js'
import { logger } from '../utils/logging/logger.js'
import { type Config } from '../utils/config.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createResult, ok, err, type Result } from 'super-result'
import { ApiDiagnosticsWriter } from '../utils/logging/api-diagnostics.js'
import {
  type ResearchPlan,
  type ExtractedFact,
  OrchestratorError,
} from './rag-types.js'
import { RagPlanner } from './rag-planner.js'
import { RagRetriever } from './rag-retriever.js'
import { RagExtractor } from './rag-extractor.js'
import { RagSynthesizer } from './rag-synthesizer.js'

export { OrchestratorError }

export class RagOrchestrator {
  static readonly OrchestratorError = OrchestratorError

  private readonly config: Config
  private aiClient: AiClient
  private vectorStore: VectorStore
  private ripgrep: RipgrepSearch
  private readonly diagnosticsWriter: ApiDiagnosticsWriter
  private planner: RagPlanner
  private retriever: RagRetriever
  private extractor: RagExtractor
  private synthesizer: RagSynthesizer

  private readonly resultFactory = createResult<OrchestratorError>((error: unknown) =>
    error instanceof OrchestratorError ? error : new OrchestratorError(String(error))
  )

  constructor(config: Config) {
    this.config = config
    this.aiClient = new AiClient(config)
    this.vectorStore = new VectorStore(config)
    this.ripgrep = new RipgrepSearch(config)
    this.diagnosticsWriter = new ApiDiagnosticsWriter(config)
    this.planner = new RagPlanner(this.config, this.aiClient, this.diagnosticsWriter)
    this.retriever = new RagRetriever(this.config, this.vectorStore, this.ripgrep, this.planner)
    this.extractor = new RagExtractor(this.aiClient, this.diagnosticsWriter)
    this.synthesizer = new RagSynthesizer(this.aiClient)
  }

  private updateSubComponents(): void {
    this.planner = new RagPlanner(this.config, this.aiClient, this.diagnosticsWriter)
    this.retriever = new RagRetriever(this.config, this.vectorStore, this.ripgrep, this.planner)
    this.extractor = new RagExtractor(this.aiClient, this.diagnosticsWriter)
    this.synthesizer = new RagSynthesizer(this.aiClient)
  }

  async answerQuestion(question: string): Promise<Result<void, OrchestratorError>> {
    logger.info(`Mightiest RAG is analyzing: "${question}"...`)

    return this.resultFactory.from(async () => await this.runAnswerQuestionFlow(question))
  }

  private async runAnswerQuestionFlow(question: string): Promise<void> {
    const plan = await this.developResearchPlan(question)
    const results = await this.executeAdaptiveHybridSearch(plan)
    const rerankedResults = await this.crossEncoderRerank(question, results)

    const isExhaustive = plan.strategy === 'exhaustive'
    const extractedFacts = await this.extractFactsWithGranularMapReduce(
      question,
      rerankedResults,
      isExhaustive
    )

    const answer = await this.generateMightiestResponse(question, extractedFacts, plan.strategy)

    logger.info('\nMightiest Answer:\n')
    logger.info(answer)

    this.displaySourceProvenance(extractedFacts)

    const feedback = await this.verifyAnswerQuality(question, answer)
    const needsCorrection = feedback.status === 'missed-info'
    if (needsCorrection) {
      logger.warn(`Self-Correction: ${feedback.suggestion}`)
    }
  }

  async chat(
    question: string,
    history: ChatMessage[]
  ): Promise<Result<LlmResponse, OrchestratorError>> {
    logger.info(`Processing chat turn: "${question}"...`)

    const refinedQuestion = await this.rephraseQuestionWithHistory(question, history)
    logger.debug(`Refined question for search: "${refinedQuestion}"`)

    const plan = await this.developResearchPlan(refinedQuestion)
    const results = await this.executeAdaptiveHybridSearch(plan)
    const rerankedResults = await this.crossEncoderRerank(refinedQuestion, results)

    const isExhaustive = plan.strategy === 'exhaustive'
    const extractedFacts = await this.extractFactsWithGranularMapReduce(
      refinedQuestion,
      rerankedResults,
      isExhaustive
    )

    const systemPrompt = this.buildChatSystemPrompt(extractedFacts)
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: question },
    ]

    const chatResult = await this.aiClient.chat(chatMessages)
    if (!chatResult.ok) {
      return err(new OrchestratorError(`Chat failed: ${errorMessageOf(chatResult.error)}`))
    }

    const response = chatResult.value

    this.displaySourceProvenance(extractedFacts)

    return ok(response)
  }

  async rephraseQuestionWithHistory(
    question: string,
    history: ChatMessage[]
  ): Promise<string> {
    this.updateSubComponents()
    return this.planner.rephraseQuestionWithHistory(question, history)
  }

  buildChatSystemPrompt(extractedFacts: ExtractedFact[]): string {
    return this.planner.buildChatSystemPrompt(extractedFacts)
  }

  async developResearchPlan(originalQuestion: string): Promise<ResearchPlan> {
    this.updateSubComponents()
    return this.planner.developResearchPlan(originalQuestion)
  }

  async executeAdaptiveHybridSearch(plan: ResearchPlan): Promise<VectorSearchResult[]> {
    this.updateSubComponents()
    return this.retriever.executeAdaptiveHybridSearch(plan)
  }

  async crossEncoderRerank(
    question: string,
    results: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    this.updateSubComponents()
    return this.retriever.crossEncoderRerank(question, results)
  }

  async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    isExhaustive: boolean
  ): Promise<ExtractedFact[]> {
    this.updateSubComponents()
    return this.extractor.extractFactsWithGranularMapReduce(question, results, isExhaustive)
  }

  async filterRelevantFacts(
    question: string,
    facts: ExtractedFact[]
  ): Promise<ExtractedFact[]> {
    this.updateSubComponents()
    return this.extractor.filterRelevantFacts(question, facts)
  }

  async generateHydePassage(question: string): Promise<string> {
    this.updateSubComponents()
    return this.planner.generateHydePassage(question)
  }

  async generateMightiestResponse(
    question: string,
    extractedFacts: ExtractedFact[],
    strategy: string
  ): Promise<string> {
    this.updateSubComponents()
    return this.synthesizer.generateMightiestResponse(question, extractedFacts, strategy)
  }

  displaySourceProvenance(extractedFacts: ExtractedFact[]): void {
    this.synthesizer.displaySourceProvenance(extractedFacts)
  }

  async verifyAnswerQuality(
    question: string,
    answer: string
  ): Promise<{ status: string; suggestion?: string }> {
    this.updateSubComponents()
    return this.planner.verifyAnswerQuality(question, answer)
  }
}
