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
  private readonly planner: RAGPlanner
  private readonly retriever: HybridRetriever
  private readonly extractor: FactExtractor
  private readonly synthesizer: ResponseSynthesizer
  private readonly ollamaClient: OllamaClient

  constructor(config: Config) {
    this.ollamaClient = new OllamaClient(config)
    const vectorStore = new VectorStore(config)
    const ripgrep = new RgSearch(config)

    this.planner = new RAGPlanner(this.ollamaClient)
    this.retriever = new HybridRetriever(config, vectorStore, ripgrep)
    this.extractor = new FactExtractor(this.ollamaClient)
    this.synthesizer = new ResponseSynthesizer(this.ollamaClient)
  }

  async answerQuestion(question: string): Promise<void> {
    try {
      logger.info(chalk.bold.cyan(`\nQuestion: ${question}`))

      logger.info('Developing research plan...')
      const plan = await this.planner.developPlan(question)

      logger.info(`Strategy identified: ${chalk.yellow(plan.strategy)}`)

      logger.info('Executing hybrid search...')
      const searchResults = await this.retriever.retrieve(plan)

      const rerankedResults = await this.crossEncoderRerank(question, searchResults)

      const extractedFacts = await this.extractor.extractFacts(
        question,
        rerankedResults,
        plan.strategy === 'exhaustive'
      )

      logger.info('Synthesizing mightiest response...')
      const answer = await this.synthesizer.synthesize(question, extractedFacts, plan.strategy)

      console.log(`\n${chalk.white(answer)}\n`)

      this.displaySourceProvenance(extractedFacts)

      const feedback = await this.synthesizer.verifyQuality(question, answer)
      const isImprovementSuggested = feedback.status === 'missed-info'
      if (isImprovementSuggested) {
        logger.warn(`Self-Correction: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errorBus.emitError(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async crossEncoderRerank(
    question: string,
    results: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    if (results.length === 0) return results

    const crossEncoder = await getCrossEncoder()
    if (!crossEncoder) {
      logger.debug(
        'Cross-encoder not available. Skipping rerank.'
      )
      return results
    }

    const { tokenizer, model } = crossEncoder
    logger.info(`Cross-encoder reranking ${results.length} candidates...`)

    const RERANK_BATCH_SIZE = 64
    const rerankScores: number[] = new Array(results.length).fill(0)

    for (let i = 0; i < results.length; i += RERANK_BATCH_SIZE) {
      const currentBatch = results.slice(i, i + RERANK_BATCH_SIZE)
      const inputPairs = currentBatch.map((res) => [
        question,
        (res.meta['snippet'] as string) || '',
      ])

      const tokenizedInputs = await tokenizer(
        inputPairs.map((pair) => pair[0]),
        {
          text_pair: inputPairs.map((pair) => pair[1]),
          padding: true,
          truncation: true,
        }
      )

      const modelOutput = await model(tokenizedInputs)
      const batchLogits: number[] = Array.from(modelOutput.logits.data as Float32Array)

      batchLogits.forEach((logit, offset) => {
        rerankScores[i + offset] = logit
      })
    }

    return results
      .map((result, index) => ({ result, rerankScore: rerankScores[index]! }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .map((entry) => entry.result)
  }

  private displaySourceProvenance(extractedFacts: ExtractedFact[]): void {
    const uniqueSourceTitles = new Set(extractedFacts.map((fact) => fact.source_title))
    if (uniqueSourceTitles.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueSourceTitles.forEach((title) => console.log(` - ${title}`))
    }
  }
}
