import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { config } from '../utils/config.js'

export class RagOrchestrator {
  private vectorStore: VectorStore
  private ollamaClient: OllamaClient
  private ripgrep: RgSearch

  constructor() {
    this.vectorStore = new VectorStore()
    this.ollamaClient = new OllamaClient()
    this.ripgrep = new RgSearch()
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest RAG analyzing request: "${question}"`)

    try {
      const plan = await this.developExecutionPlan(question)
      logger.info(`Strategy: ${chalk.bold.yellow(plan.strategy.toUpperCase())}`)
      logger.info(`Search Variations: ${chalk.gray(plan.queries.join(' | '))}`)

      const searchResults = await this.executeHybridSearch(plan)

      if (searchResults.length === 0) {
        logger.warn('History is silent on this topic. Using core AI knowledge.')
      }

      const exhaustiveMode = plan.strategy === 'exhaustive'
      const contextFacts = await this.extractFactsWithGranularMapReduce(
        question,
        searchResults,
        exhaustiveMode
      )

      logger.info(`Synthesizing final answer from ${contextFacts.length} verified facts...`)
      const finalAnswer = await this.generateMightiestResponse(
        question,
        contextFacts,
        plan.strategy
      )

      console.log(`\n${chalk.bold.green('Mightiest AI Response:')}\n`)
      console.log(finalAnswer)

      this.displaySourceList(contextFacts)

      const feedback = await this.verifyAnswerQuality(question, finalAnswer, contextFacts)
      if (feedback.status === 'improvement-needed') {
        logger.warn(`Self-Correction: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developExecutionPlan(originalQuestion: string): Promise<{
    strategy: 'precise' | 'exhaustive'
    queries: string[]
    keywords: string[]
    filters: any
  }> {
    const plannerPrompt = `
Analyze the user request: "${originalQuestion}"
Decide the best RAG strategy:
- "precise": The user wants a specific fact, code snippet, or a direct answer to a narrow question.
- "exhaustive": The user wants to know everything said about a topic, a summary of all threads, or a broad overview where missing one detail would be a failure.

Generate:
1. strategy: "precise" or "exhaustive"
2. queries: 3 semantic search variations.
3. keywords: 3-5 exact keywords for ripgrep (focus on names, unique technical terms).
4. filters: Any mentioned thread titles or space names.

Return EXACTLY JSON:
{
  "strategy": "precise" | "exhaustive",
  "queries": ["q1", "q2", "q3"],
  "keywords": ["k1", "k2", "k3"],
  "filters": { "title": "...", "space": "..." }
}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
      return {
        strategy: json.strategy || 'precise',
        queries: json.queries || [originalQuestion],
        keywords: json.keywords || [],
        filters: json.filters || {},
      }
    } catch (_err) {
      return { strategy: 'precise', queries: [originalQuestion], keywords: [], filters: {} }
    }
  }

  private async executeHybridSearch(plan: any): Promise<VectorSearchResult[]> {
    const resultsPool: VectorSearchResult[][] = []

    for (const q of plan.queries) {
      const res = await this.vectorStore.search(q, 40)
      resultsPool.push(res)
    }

    for (const k of plan.keywords) {
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: k })
        const converted = matches.map((m) => ({
          meta: {
            path: join(config.exportDir, m.path),
            snippet: m.text,
            title: m.path.split('/').pop() || 'Untitled',
            id: m.path + m.line,
          },
          score: 1.0,
        }))
        resultsPool.push(converted as any)
      } catch (_err) {
        /* oxlint-disable-next-line no-empty */
      }
    }

    return this.reciprocalRankFusion(resultsPool)
  }

  private reciprocalRankFusion(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const scores = new Map<string, { res: VectorSearchResult; score: number }>()
    pools.forEach((pool) => {
      pool.forEach((res, rank) => {
        const path = res.meta['path'] || 'unknown'
        const snippet = res.meta['snippet'] || ''
        const id = res.meta['id'] || `${path}:${snippet}`
        const s = 1 / (60 + rank)
        if (scores.has(id)) scores.get(id)!.score += s
        else scores.set(id, { res, score: s })
      })
    })
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map((v) => v.res)
  }

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    exhaustive: boolean
  ): Promise<any[]> {
    const poolLimit = exhaustive ? 60 : 20
    const pool = results.slice(0, poolLimit)
    if (pool.length === 0) return []

    const chunkSize = 5
    const factBatches: any[][] = []

    logger.info(`Processing ${pool.length} context snippets in batches of ${chunkSize}...`)

    for (let i = 0; i < pool.length; i += chunkSize) {
      const chunk = pool.slice(i, i + chunkSize)
      const batchPrompt = `
Question: "${question}"
Context Snippets:
${chunk.map((r, j) => `[ID ${j}] Thread: ${r.meta['title']}\nSnippet: ${r.meta['snippet']}`).join('\n\n')}

Extract every specific fact, detail, or mention relevant to the question.
Include technical terms, dates, and names.
Return as JSON array: [{"fact": "...", "source_title": "..."}]
`
      try {
        const response = await this.ollamaClient.generate(batchPrompt)
        const facts = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]')
        factBatches.push(facts)
      } catch (_err) {
        factBatches.push(
          chunk.map((r) => ({ fact: r.meta['snippet'], source_title: r.meta['title'] }))
        )
      }
    }

    return factBatches.flat()
  }

  private async generateMightiestResponse(
    question: string,
    facts: any[],
    strategy: string
  ): Promise<string> {
    const factsList = facts.map((f, i) => `[Fact ${i}] (${f.source_title}): ${f.fact}`).join('\n')

    const prompt = `
SYSTEM: You are the MIGHTIEST personal assistant. You have absolute mastery over the user's Perplexity history.
STRATEGY: ${strategy}

ALL RELEVANT FACTS EXTRACTED FROM HISTORY:
${factsList || 'No relevant facts found in history.'}

USER QUESTION: "${question}"

INSTRUCTIONS:
1. Provide a definitive, detailed answer.
2. If STRATEGY is "exhaustive", you MUST mention every unique thread and fact found. Do not summarize away important details.
3. Use Chain-of-Thought reasoning to connect dots across different conversations.
4. Cite sources using [Fact N].
5. If something is missing from history, state it clearly before using your general knowledge.

ANSWER:`
    return this.ollamaClient.generate(prompt)
  }

  private displaySourceList(facts: any[]): void {
    const uniqueThreads = new Set(facts.map((f) => f.source_title))
    if (uniqueThreads.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueThreads.forEach((t) => console.log(` - ${t}`))
    }
  }

  private async verifyAnswerQuality(
    question: string,
    answer: string,
    facts: any[]
  ): Promise<{ status: string; suggestion?: string }> {
    const prompt = `
Question: "${question}"
Facts: ${facts.length}
Answer: "${answer.slice(0, 500)}..."

Check: Did the answer overlook any of the facts?
Return JSON: {"status": "ok" | "improvement-needed", "suggestion": "..."}
`
    try {
      const res = await this.ollamaClient.generate(prompt)
      return JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "ok"}')
    } catch (_err) {
      return { status: 'ok' }
    }
  }
}
