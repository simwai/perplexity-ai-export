import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { config } from '../utils/config.js'

interface ResearchNode {
  fact: string
  source: string
  id: string
  original?: VectorSearchResult
}

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
      const researchPlan = await this.developStrategicPlan(question)
      logger.info(`Execution Strategy: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (researchPlan.hardKeywords?.length) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      let researchArchive: ResearchNode[] = []
      let iterations = 0
      const MAX_ITERATIONS = 3
      let activeQueries = researchPlan.queries
      let activeHardKeywords = researchPlan.hardKeywords

      while (iterations < MAX_ITERATIONS) {
        iterations++
        logger.info(`Research Cycle ${iterations}/${MAX_ITERATIONS}...`)

        const candidates = await this.performHybridRetrieval(activeQueries, activeHardKeywords)
        const newFindings = await this.performDeepResearch(question, candidates, researchPlan.strategy, researchArchive)
        researchArchive = [...researchArchive, ...newFindings]

        const diagnostic = await this.assessResearchDepth(question, researchArchive, researchPlan.strategy)
        if (diagnostic.status === 'saturated' || iterations >= MAX_ITERATIONS) {
          logger.success('Information harvesting complete.')
          break
        }

        logger.info(`Knowledge Gap: ${chalk.gray(diagnostic.gapDescription)}`)
        activeQueries = diagnostic.followUpQueries
        activeHardKeywords = diagnostic.followUpKeywords
      }

      logger.info(`Final synthesis from ${researchArchive.length} grounded findings...`)
      let finalAnswer = await this.narrateAuthoredResponse(question, researchArchive, researchPlan.strategy)

      const auditFeedback = await this.auditFidelity(question, finalAnswer, researchArchive)
      if (auditFeedback.status === 'risk') {
        logger.warn(`Hallucination/Omission detected! Self-correcting...`)
        finalAnswer = await this.narrateAuthoredResponse(question, researchArchive, researchPlan.strategy, auditFeedback.critique)
      }

      console.log(`\n${chalk.bold.green('Mightiest AI Insights:')}\n`)
      console.log(finalAnswer)

      this.displaySourceProvenance(researchArchive)

    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developStrategicPlan(question: string): Promise<any> {
    const plannerPrompt = `
Analyze: "${question}"
1. Strategy: "precise" (specific fact/detail) or "exhaustive" (broad summary/full history).
2. Initial Queries: 3 semantic search phrases.
3. Hard Keywords: IDs, unique names, or terms for exact matching.
Return JSON: {"strategy": "precise"|"exhaustive", "queries": [], "hardKeywords": [], "filters": {}}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      return JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
    } catch (_err) {
      return { strategy: 'precise', queries: [question], hardKeywords: [], filters: {} }
    }
  }

  private async performHybridRetrieval(queries: string[], keywords: string[]): Promise<VectorSearchResult[]> {
    const candidatePools: VectorSearchResult[][] = []

    for (const q of queries) {
      const vectorResults = await this.vectorStore.search(q, 40)
      candidatePools.push(vectorResults)
    }

    if (keywords.length > 0) {
      logger.info(`Triggering targeted keyword search for: ${chalk.gray(keywords.join(', '))}`)
      for (const k of keywords) {
        try {
          const exactMatches = await this.ripgrep.captureSearchMatches({ pattern: k })
          candidatePools.push(exactMatches.map(m => ({
            meta: {
              path: join(config.exportDir, m.path),
              snippet: m.text,
              title: m.path.split('/').pop() || 'Untitled'
            },
            score: 1.0
          })) as any)
        } catch (_err) { /* oxlint-disable-next-line no-empty */ }
      }
    }

    return this.reciprocalRankFusion(candidatePools)
  }

  private reciprocalRankFusion(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const globalScores = new Map<string, { res: VectorSearchResult; score: number }>()
    pools.forEach(pool => {
      pool.forEach((res, rank) => {
        const path = String(res.meta['path'] || 'unknown')
        const snippet = String(res.meta['snippet'] || '')
        const id = String(res.meta['id'] || `${path}:${snippet}`)
        const s = 1 / (60 + rank)
        if (globalScores.has(id)) globalScores.get(id)!.score += s
        else globalScores.set(id, { res, score: s })
      })
    })
    return Array.from(globalScores.values()).sort((a, b) => b.score - a.score).map(v => v.res)
  }

  private async performDeepResearch(question: string, candidates: VectorSearchResult[], strategy: string, archive: ResearchNode[]): Promise<ResearchNode[]> {
    const researchLimit = strategy === 'exhaustive' ? 60 : 30
    const freshCandidates = candidates.filter(c => !archive.some(a => a.id === (String(c.meta['id']) || `${String(c.meta['path'])}:${String(c.meta['snippet'])}`)))
    const activePool = freshCandidates.slice(0, researchLimit)

    if (activePool.length === 0) return []

    const researchFindings: ResearchNode[] = []
    const batchSize = 10

    for (let i = 0; i < activePool.length; i += batchSize) {
      const currentBatch = activePool.slice(i, i + batchSize)
      const contextNodes = currentBatch.map((r, j) => `[Node ${i + j}] ${String(r.meta['title'])}: ${String(r.meta['snippet'])}`).join('\n\n')

      const researcherPrompt = `
You are the RESEARCHER. Analyze these snippets for: "${question}"
Previous knowledge: ${archive.length} nodes.

Context Nodes:
${contextNodes}

Extract every NEW relevant fact, technical detail, or mention.
Return JSON array: [{"fact": "...", "source": "...", "node_id": N}]
`
      try {
        const response = await this.ollamaClient.generate(researcherPrompt)
        const extractedJson = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]')
        extractedJson.forEach((finding: any) => {
          const originalRes = activePool[finding.node_id - i]
          if (originalRes) {
            researchFindings.push({
              fact: finding.fact,
              source: finding.source,
              id: String(originalRes.meta['id'] || `${String(originalRes.meta['path'])}:${String(originalRes.meta['snippet'])}`),
              original: originalRes
            })
          }
        })
      } catch (_err) {
        currentBatch.forEach((r, j) => researchFindings.push({
          fact: String(r.meta['snippet']),
          source: String(r.meta['title']),
          id: String(i + j),
          original: r
        }))
      }
    }

    return researchFindings
  }

  private async assessResearchDepth(question: string, archive: ResearchNode[], strategy: string): Promise<any> {
    const depthPrompt = `
Assess knowledge state for: "${question}"
Findings: ${archive.length} nodes.
Strategy: ${strategy}

Is the history exhausted for this topic?
Return JSON: {"status": "saturated"|"incomplete", "gapDescription": "...", "followUpQueries": [], "followUpKeywords": []}
`
    try {
      const res = await this.ollamaClient.generate(depthPrompt)
      return JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "saturated"}')
    } catch (_err) { return { status: 'saturated' } }
  }

  private async narrateAuthoredResponse(question: string, findings: ResearchNode[], strategy: string, critique?: string): Promise<string> {
    const contextLines = findings.map((f, i) => `[Node ${i}] (${f.source}): ${f.fact}`).join('\n')
    const critiqueSection = critique ? `\nSELF-CRITIQUE OF PREVIOUS ATTEMPT:\n${critique}\n` : ''

    const narrationPrompt = `
You are the AUTHORITATIVE NARRATOR. Answer: "${question}"
Strategy: ${strategy}${critiqueSection}
History Context:
${contextLines}

INSTRUCTIONS:
1. Synthesize a definitive, authoritative answer.
2. If STRATEGY is "exhaustive", provide a thread-by-thread analysis.
3. Be technically precise. Connect findings across conversations.
4. Cite using [Node N].
5. Tone: Masterful and highly grounded.

ANSWER:
`
    return this.ollamaClient.generate(narrationPrompt)
  }

  private async auditFidelity(question: string, answer: string, findings: ResearchNode[]): Promise<any> {
    const auditPrompt = `
AUDIT: Validate this answer against source nodes.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Source count: ${findings.length}

Did the Narrator hallucinate? Or miss a critical grounded fact?
Return JSON: {"status": "ok"|"risk", "critique": "..."}
`
    try {
      const res = await this.ollamaClient.generate(auditPrompt)
      return JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "ok"}')
    } catch (_err) { return { status: 'ok' } }
  }

  private displaySourceProvenance(findings: ResearchNode[]): void {
    const threadProvenance = new Map()
    findings.forEach(f => {
      const title = f.source || String(f.original?.meta?.title || 'Untitled')
      const path = String(f.original?.meta?.path || 'unknown')
      threadProvenance.set(title, path)
    })
    if (threadProvenance.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      for (const [title, path] of threadProvenance) {
        console.log(` - ${title} (${chalk.gray(path)})`)
      }
    }
  }
}
