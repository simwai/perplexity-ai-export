import { errorBus } from '../utils/error-bus.js'
import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { type Config } from '../utils/config.js'

// Cross-encoder reranker — loaded lazily on first use (downloads ~85MB ONNX model once)
let _tokenizer: any = null
let _model: any = null

async function getCrossEncoder() {
  if (!_tokenizer || !_model) {
    // @ts-expect-error — optional peer dep, gracefully skipped if not installed
    const { AutoTokenizer, AutoModelForSequenceClassification } =
      await import('@huggingface/transformers').catch(() => null)
    if (!AutoTokenizer) return null
    _tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
    _model = await AutoModelForSequenceClassification.from_pretrained(
      'Xenova/ms-marco-MiniLM-L-6-v2',
      { dtype: 'int8' }
    )
  }
  return { tokenizer: _tokenizer, model: _model }
}

export class RagOrchestrator {
  private vectorStore: VectorStore
  private ollamaClient: OllamaClient
  private ripgrep: RgSearch
  private config: Config

  constructor(config: Config) {
    this.config = config
    this.vectorStore = new VectorStore(config)
    this.ollamaClient = new OllamaClient(config)
    this.ripgrep = new RgSearch(config)
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest Adaptive RAG processing: "${question}"`)

    try {
      const researchPlan = await this.developResearchPlan(question)
      const exhaustiveMode = researchPlan.strategy === 'exhaustive'

      logger.info(`Plan: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (exhaustiveMode) {
        logger.warn(
          `Exhaustive mode enabled. This may take a while as I'll be doing a deep dive into your history.`
        )
      }

      if (researchPlan.hardKeywords?.length) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      if (researchPlan.hydePassage) {
        logger.debug(`HyDE passage generated: "${researchPlan.hydePassage.slice(0, 80)}..."`)
      }

      const searchResults = await this.executeAdaptiveHybridSearch(researchPlan)
      const rerankedResults = await this.crossEncoderRerank(question, searchResults)
      const contextFacts = await this.extractFactsWithGranularMapReduce(
        question,
        rerankedResults,
        exhaustiveMode
      )

      logger.info(`Synthesizing final answer from ${contextFacts.length} verified facts...`)
      const finalAnswer = await this.generateMightiestResponse(
        question,
        contextFacts,
        researchPlan.strategy
      )

      console.log(`\n${chalk.bold.green('Mightiest AI Response:')}\n`)
      console.log(finalAnswer)

      this.displaySourceProvenance(contextFacts)

      const feedback = await this.verifyAnswerQuality(question, finalAnswer, contextFacts)
      if (feedback.status === 'improvement-needed') {
        logger.warn(`Self-Correction: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      errorBus.emitError(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developResearchPlan(originalQuestion: string): Promise<{
    strategy: 'precise' | 'exhaustive'
    queries: string[]
    hardKeywords: string[]
    hydePassage: string
    filters: any
  }> {
    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
4. HyDE: Write 1-2 sentences that would plausibly appear in a saved answer to this question. Write as if it's content already stored, not as a reply.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "hydePassage": "...", "filters": {}}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
      return {
        strategy: json.strategy || 'precise',
        queries: json.queries || [originalQuestion],
        hardKeywords: json.hardKeywords || [],
        hydePassage: json.hydePassage || '',
        filters: json.filters || {},
      }
    } catch (_err) {
      return {
        strategy: 'precise',
        queries: [originalQuestion],
        hardKeywords: [],
        hydePassage: '',
        filters: {},
      }
    }
  }

  private async executeAdaptiveHybridSearch(plan: {
    queries: string[]
    hardKeywords: string[]
    hydePassage: string
  }): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []

    for (let i = 0; i < (plan.queries || []).length; i++) {
      const q = plan.queries[i]!
      logger.debug(`Executing semantic search [${i + 1}/${plan.queries.length}]: "${q}"`)
      const res = await this.vectorStore.search(q, 40)
      searchPools.push(res)
    }

    // HyDE: search using the hypothetical document passage for better semantic match
    if (plan.hydePassage) {
      logger.debug(`Executing HyDE search: "${plan.hydePassage.slice(0, 60)}..."`)
      const hydeResults = await this.vectorStore.search(plan.hydePassage, 40)
      searchPools.push(hydeResults)
    }

    const keywordPool: VectorSearchResult[] = []
    for (let i = 0; i < (plan.hardKeywords || []).length; i++) {
      const k = plan.hardKeywords[i]!
      logger.debug(`Executing keyword search [${i + 1}/${plan.hardKeywords.length}]: "${k}"`)
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: k })
        const converted: VectorSearchResult[] = matches.map((m) => ({
          meta: {
            path: join(this.config.exportDir, m.path),
            snippet: m.text,
            title: m.path.split('/').pop() || 'Untitled',
            id: m.path + m.line,
          },
          score: 1.0,
        }))
        keywordPool.push(...converted)
      } catch (_err) {
        /* oxlint-disable-next-line no-empty */
      }
    }

    if (keywordPool.length > 0) {
      searchPools.push(keywordPool)
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const scores = new Map<string, { res: VectorSearchResult; score: number }>()
    pools.forEach((pool) => {
      pool.forEach((res, rank) => {
        const path = res.meta['path'] || 'unknown'
        const snippet = res.meta['snippet'] || ''
        const id = res.meta['id'] || `${path}:${snippet}`
        const s = 1 / (60 + rank)
        if (scores.has(id)) {
          scores.get(id)!.score += s
        } else {
          scores.set(id, { res, score: s })
        }
      })
    })
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map((v) => v.res)
  }

  /**
   * Cross-encoder reranking using Xenova/ms-marco-MiniLM-L-6-v2 (ONNX, runs locally).
   * Gracefully falls back to original order if @huggingface/transformers is not installed.
   * Install: npm install @huggingface/transformers
   */
  private async crossEncoderRerank(
    question: string,
    results: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    if (results.length === 0) return results

    const ce = await getCrossEncoder()
    if (!ce) {
      logger.debug(
        'Cross-encoder not available (run: npm install @huggingface/transformers). Skipping rerank.'
      )
      return results
    }

    const { tokenizer, model } = ce
    logger.info(`Cross-encoder reranking ${results.length} candidates...`)

    const BATCH_SIZE = 64
    const scores: number[] = new Array(results.length).fill(0)

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE)
      const pairs = batch.map((r) => [question, (r.meta['snippet'] as string) || ''])
      const inputs = await tokenizer(
        pairs.map((p) => p[0]),
        {
          text_pair: pairs.map((p) => p[1]),
          padding: true,
          truncation: true,
        }
      )
      const output = await model(inputs)
      // Read raw logits directly — do NOT use pipeline() which returns score: 1.0 always
      const logits: number[] = Array.from(output.logits.data as Float32Array)
      logits.forEach((s, j) => {
        scores[i + j] = s
      })
    }

    return results
      .map((res, i) => ({ res, score: scores[i]! }))
      .sort((a, b) => b.score - a.score)
      .map((v) => v.res)
  }

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    exhaustive: boolean
  ): Promise<any[]> {
    // Bumped from 20 → 35 in precise mode to reduce missed details
    const poolLimit = exhaustive ? 60 : 35
    const pool = results.slice(0, poolLimit)
    if (pool.length === 0) return []

    const findings: any[] = []
    const batchSize = 10
    const totalBatches = Math.ceil(pool.length / batchSize)

    for (let i = 0, batchIdx = 0; i < pool.length; i += batchSize, batchIdx++) {
      const batch = pool.slice(i, i + batchSize)
      logger.info(`Analyzing history snippets... batch ${batchIdx + 1} of ${totalBatches}`)

      const researchPrompt = `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${batch.map((r, j) => `[Node ${i + j}] ${r.meta['title']}: ${r.meta['snippet']}`).join('\n\n')}

Extract every specific fact, mention, date, or piece of code.
Return JSON array: [{"fact": "...", "node_id": N, "thread": "..."}]
`
      try {
        const response = await this.ollamaClient.generate(researchPrompt)
        const extracted = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]')
        extracted.forEach((f: any) => {
          const original = pool[f.node_id - i]
          findings.push({
            fact: f.fact,
            source_title: original?.meta['title'] || f.thread || 'Unknown',
            thread: f.thread || original?.meta['title'] || 'Unknown',
          })
        })
      } catch (_err) {
        batch.forEach((r) => {
          findings.push({
            fact: r.meta['snippet'],
            source_title: r.meta['title'],
          })
        })
      }
    }

    return findings
  }

  private async generateMightiestResponse(
    question: string,
    findings: any[],
    strategy: string
  ): Promise<string> {
    const prompt = `
You are the Narrator. Synthesize these research findings into a cohesive, mightiest answer for: "${question}"
Strategy: ${strategy}
Findings:
${findings.map((f, i) => `[Find ${i}] (${f.source_title}): ${f.fact}`).join('\n')}

INSTRUCTIONS:
1. Provide a comprehensive, authoritative response.
2. If "exhaustive", list ALL relevant conversations and what they contributed.
3. Be specific with names and technical details.
4. Cite everything with [Find N].

ANSWER:
`
    return this.ollamaClient.generate(prompt)
  }

  private displaySourceProvenance(facts: any[]): void {
    const uniqueThreads = new Set(facts.map((f: any) => f.source_title))
    if (uniqueThreads.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueThreads.forEach((t) => console.log(` - ${t}`))
    }
  }

  private async verifyAnswerQuality(
    question: string,
    answer: string,
    _facts: any[]
  ): Promise<{ status: string; suggestion?: string }> {
    const prompt = `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
    try {
      const res = await this.ollamaClient.generate(prompt)
      return JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "ok"}')
    } catch (_err) {
      return { status: 'ok' }
    }
  }
}
