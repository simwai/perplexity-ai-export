import { type VectorSearchResult, VectorStore } from '../search/vector-store.js'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { OllamaClient } from './ollama-client.js'
import { errorBus } from '../utils/error-bus.js'
import { RgSearch } from '../search/rg-search.js'
import chalk from 'chalk'
import { getCrossEncoder } from './cross-encoder.js'

import { RAGPlanner } from './rag/planner.js'
import { HybridRetriever } from './rag/retriever.js'
import { FactExtractor } from './rag/extractor.js'
import { ResponseSynthesizer } from './rag/synthesizer.js'
import { type ExtractedFact } from './rag/types.js'

export class RagOrchestrator {
  private readonly researchPlanner: RAGPlanner
  private readonly hybridRetriever: HybridRetriever
  private readonly factExtractor: FactExtractor
  private readonly responseSynthesizer: ResponseSynthesizer
  private readonly ollamaClient: OllamaClient

  constructor(applicationConfig: Config) {
    this.ollamaClient = new OllamaClient(applicationConfig)
    const conversationVectorStore = new VectorStore(applicationConfig)
    const ripgrepSearchEngine = new RgSearch(applicationConfig)

    this.researchPlanner = new RAGPlanner(this.ollamaClient)
    this.hybridRetriever = new HybridRetriever(
      applicationConfig,
      conversationVectorStore,
      ripgrepSearchEngine
    )
    this.factExtractor = new FactExtractor(this.ollamaClient)
    this.responseSynthesizer = new ResponseSynthesizer(this.ollamaClient)
  }

  async answerQuestion(userQuestion: string): Promise<void> {
    try {
      logger.info(chalk.bold.cyan(`\nQuestion: ${userQuestion}`))

      logger.info('Developing research plan...')
      const researchPlan = await this.researchPlanner.developPlan(userQuestion)

      logger.info(`Strategy identified: ${chalk.yellow(researchPlan.researchStrategy)}`)

      logger.info('Executing hybrid search...')
      const rawSearchResults = await this.hybridRetriever.retrieve(researchPlan)

      const rerankedSearchResults = await this.executeCrossEncoderReranking(
        userQuestion,
        rawSearchResults
      )

      const extractedResearchFacts = await this.factExtractor.extractFacts(
        userQuestion,
        rerankedSearchResults,
        researchPlan.researchStrategy === 'exhaustive'
      )

      logger.info('Synthesizing mightiest response...')
      const finalGeneratedAnswer = await this.responseSynthesizer.synthesize(
        userQuestion,
        extractedResearchFacts,
        researchPlan.researchStrategy
      )

      console.log(`\n${chalk.white(finalGeneratedAnswer)}\n`)

      this.displaySourceProvenance(extractedResearchFacts)

      const verificationFeedback = await this.responseSynthesizer.verifyQuality(
        userQuestion,
        finalGeneratedAnswer
      )
      const isImprovementSuggested = verificationFeedback.verificationStatus === 'missed-info'

      if (isImprovementSuggested) {
        logger.warn(`Self-Correction: ${chalk.gray(verificationFeedback.improvementSuggestion)}`)
      }
    } catch (orchestrationError) {
      errorBus.emitError('Mightiest RAG pipeline failed', orchestrationError, {
        question: userQuestion,
      })
    }
  }

  private async executeCrossEncoderReranking(
    userQuestion: string,
    searchResults: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    if (searchResults.length === 0) return searchResults

    const crossEncoderInstance = await getCrossEncoder()
    if (!crossEncoderInstance) {
      logger.debug('Cross-encoder not available. Skipping rerank.')
      return searchResults
    }

    try {
      const { tokenizer, model } = crossEncoderInstance
      logger.info(`Cross-encoder reranking ${searchResults.length} candidates...`)

      const RERANKING_BATCH_SIZE = 64
      const calculatedRerankScores: number[] = new Array(searchResults.length).fill(0)

      for (
        let currentBatchOffset = 0;
        currentBatchOffset < searchResults.length;
        currentBatchOffset += RERANKING_BATCH_SIZE
      ) {
        const currentBatch = searchResults.slice(
          currentBatchOffset,
          currentBatchOffset + RERANKING_BATCH_SIZE
        )
        const inputPairsForEncoder = currentBatch.map((result) => [
          userQuestion,
          (result.meta['snippet'] as string) || '',
        ])

        const tokenizedEncoderInputs = await tokenizer(
          inputPairsForEncoder.map((pair) => pair[0]),
          {
            text_pair: inputPairsForEncoder.map((pair) => pair[1]),
            padding: true,
            truncation: true,
          }
        )

        const modelOutputPrediction = await model(tokenizedEncoderInputs)
        const batchLogitScores: number[] = Array.from(
          modelOutputPrediction.logits.data as Float32Array
        )

        batchLogitScores.forEach((logit, indexWithinBatch) => {
          calculatedRerankScores[currentBatchOffset + indexWithinBatch] = logit
        })
      }

      return searchResults
        .map((result, resultIndex) => ({
          result,
          rerankScore: calculatedRerankScores[resultIndex]!,
        }))
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .map((scoredEntry) => scoredEntry.result)
    } catch (rerankingError) {
      errorBus.emitError('Cross-encoder reranking failed', rerankingError)
      return searchResults
    }
  }

  private displaySourceProvenance(extractedResearchFacts: ExtractedFact[]): void {
    const uniqueSourceDocumentTitles = new Set(
      extractedResearchFacts.map((fact) => fact.sourceDocumentTitle)
    )
    if (uniqueSourceDocumentTitles.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueSourceDocumentTitles.forEach((documentTitle) => console.log(` - ${documentTitle}`))
    }
  }
}
