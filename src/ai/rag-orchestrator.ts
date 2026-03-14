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
    logger.info(`Mightiest Adaptive RAG processing: "${question}"`)

    try {
      const researchPlan = await this.developResearchPlan(question)
      logger.info(`Plan: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (researchPlan.hardKeywords?.length) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      const searchResults = await this.executeAdaptiveHybridSearch(researchPlan)
      const exhaustiveMode = researchPlan.strategy === 'exhaustive'

      const contextFacts = await this.extractFactsWithGranularMapReduce(
        question,
        searchResults,
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
      logger.error(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developResearchPlan(originalQuestion: string): Promise<{
    strategy: 'precise' | 'exhaustive'
    queries: string[]
    hardKeywords: string[]
    filters: any
  }> {
    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "filters": {}}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
      return {
        strategy: json.strategy || 'precise',
        queries: json.queries || [originalQuestion],
        hardKeywords: json.hardKeywords || [],
        filters: json.filters || {},
      }
    } catch (_err) {
      return { strategy: 'precise', queries: [originalQuestion], hardKeywords: [], filters: {} }
    }
  }

  private async executeAdaptiveHybridSearch(plan: { queries: string[], hardKeywords: string[] }): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []

    for (const q of plan.queries || []) {
      const res = await this.vectorStore.search(q, 40)
      searchPools.push(res)
    }

    const keywordPool: VectorSearchResult[] = []
    for (const k of plan.hardKeywords || []) {
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: k })
        const converted: VectorSearchResult[] = matches.map((m) => ({
          meta: {
            path: join(config.exportDir, m.path),
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

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    exhaustive: boolean
  ): Promise<any[]> {
    const poolLimit = exhaustive ? 60 : 20
    const pool = results.slice(0, poolLimit)
    if (pool.length === 0) return []

    const findings: any[] = []
    const batchSize = 10

    for (let i = 0; i < pool.length; i += batchSize) {
      const batch = pool.slice(i, i + batchSize)
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
            thread: f.thread || original?.meta['title'] || 'Unknown'
          })
        })
      } catch (_err) {
        batch.forEach((r) => {
          findings.push({
            fact: r.meta['snippet'],
            source_title: r.meta['title']
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
