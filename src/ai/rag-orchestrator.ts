import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

export class RagOrchestrator {
  private vectorStore: VectorStore
  private ollamaClient: OllamaClient

  constructor() {
    this.vectorStore = new VectorStore()
    this.ollamaClient = new OllamaClient()
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Deep analyzing request: "${question}"`)

    try {
      const analysis = await this.performDeepQueryAnalysis(question)
      logger.info(`Intent: ${chalk.gray(analysis.intent)}`)
      logger.info(`Search variations: ${chalk.gray(analysis.queries.join(' | '))}`)

      const rawResultsPool = await this.collectMultiQueryResults(analysis.queries, analysis.filters)

      let rankedResults = this.applyReciprocalRankFusion(rawResultsPool)

      if (analysis.temporalRequirement) {
        rankedResults = this.applyTemporalWeighting(rankedResults, analysis.temporalRequirement)
      }

      const candidatePoolSize = analysis.intent === 'broad' ? 40 : 20
      const topCandidates = rankedResults.slice(0, candidatePoolSize)

      if (topCandidates.length === 0) {
        logger.warn('No relevant context found in history. Using general knowledge.')
      }

      const rerankedContext = await this.rerankWithLlm(question, topCandidates)
      const groupedContext = this.groupChunksByParentThread(rerankedContext)

      logger.info(`Synthesizing answer from ${groupedContext.size} relevant conversations...`)

      const atomicFacts = await this.extractKeyFindings(question, groupedContext)
      if (atomicFacts) {
        logger.info(`Extracted ${chalk.gray(atomicFacts.split('\n').length)} key observations from history.`)
      }

      const finalPrompt = this.constructAdvancedRagPrompt(question, groupedContext, analysis.intent, atomicFacts)
      const response = await this.ollamaClient.generate(finalPrompt)

      console.log(`\n${chalk.bold.green('AI Insights:')}\n`)
      console.log(response)

      if (groupedContext.size > 0) {
        this.displaySourceThreads(groupedContext)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`Advanced RAG process failed: ${errorMessage}`)
    }
  }

  private async performDeepQueryAnalysis(originalQuestion: string): Promise<{
    queries: string[];
    intent: 'specific' | 'broad';
    filters?: { title?: string; space?: string };
    temporalRequirement?: 'latest' | 'recent' | 'all'
  }> {
    const analysisPrompt = `
Analyze: "${originalQuestion}"
1. Intent: "broad" (summary/list/overview) or "specific" (detailed fact/how-to).
2. Variations: 3 distinct search queries (keyword-heavy, natural language, conceptual).
3. Metadata: Any title/space filters mentioned.
4. Temporal: Does the user want "latest", "recent", or "all" history?

Return EXACTLY this JSON:
{
  "intent": "broad" | "specific",
  "queries": ["q1", "q2", "q3"],
  "filters": { "title": "...", "space": "..." },
  "temporal": "latest" | "recent" | "all"
}
`
    try {
      const response = await this.ollamaClient.generate(analysisPrompt)
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          queries: parsed.queries && Array.isArray(parsed.queries) ? parsed.queries : [originalQuestion],
          intent: parsed.intent === 'broad' ? 'broad' : 'specific',
          filters: (parsed.filters?.title || parsed.filters?.space) ? parsed.filters : undefined,
          temporalRequirement: parsed.temporal || 'all'
        }
      }
    } catch (_err) { /* fallback */ }

    return { queries: [originalQuestion], intent: 'specific', temporalRequirement: 'all' }
  }

  private async collectMultiQueryResults(queries: string[], filters?: any): Promise<VectorSearchResult[][]> {
    const resultsPool: VectorSearchResult[][] = []
    for (const query of queries) {
      let results: VectorSearchResult[]
      if (filters && (filters.title || filters.space)) {
        results = await this.vectorStore.searchWithMetadataFilter(query, (meta: Record<string, any>) => {
          let match = true
          if (filters.title) match = match && !!(meta['title'] as string)?.toLowerCase().includes(filters.title.toLowerCase())
          if (filters.space) match = match && !!(meta['spaceName'] as string)?.toLowerCase().includes(filters.space.toLowerCase())
          return match
        }, 30)
      } else {
        results = await this.vectorStore.search(query, 30)
      }
      resultsPool.push(results)
    }
    return resultsPool
  }

  private applyReciprocalRankFusion(resultsPool: VectorSearchResult[][]): VectorSearchResult[] {
    const fusionScores = new Map<string, { result: VectorSearchResult; score: number }>()
    const k_constant = 60

    resultsPool.forEach((results) => {
      results.forEach((res, rank) => {
        const id = res.meta['id']!
        const score = 1.0 / (k_constant + rank)
        const existing = fusionScores.get(id)
        if (existing) {
          existing.score += score
        } else {
          fusionScores.set(id, { result: res, score })
        }
      })
    })

    return Array.from(fusionScores.values())
      .sort((a, b) => b.score - a.score)
      .map(v => v.result)
  }

  private applyTemporalWeighting(results: VectorSearchResult[], requirement: 'latest' | 'recent' | 'all'): VectorSearchResult[] {
    if (requirement === 'all') return results

    return [...results].sort((a, b) => {
      const dateA = new Date(a.meta['date'] || 0).getTime()
      const dateB = new Date(b.meta['date'] || 0).getTime()
      if (requirement === 'latest') return dateB - dateA
      return dateB - dateA
    })
  }

  private async rerankWithLlm(question: string, candidates: VectorSearchResult[]): Promise<VectorSearchResult[]> {
    if (candidates.length <= 5) return candidates

    logger.info(`LLM Reranking ${candidates.length} candidates pool...`)
    const rerankPrompt = `
Question: "${question}"
Snippets:
${candidates.map((c, i) => `[${i}] Thread: ${c.meta['title']}\nSnippet: ${c.meta['snippet']}`).join('\n\n')}

Identify the indexes of the most relevant snippets to answer the question.
Return ONLY a comma-separated list of numbers.
`
    try {
      const response = await this.ollamaClient.generate(rerankPrompt)
      const indexes = response.match(/\d+/g)?.map(Number) || []
      const filtered = indexes
        .filter(idx => idx >= 0 && idx < candidates.length)
        .map(idx => candidates[idx]!)

      return filtered.length > 0 ? filtered : candidates.slice(0, 10)
    } catch (_err) {
      return candidates.slice(0, 10)
    }
  }

  private async extractKeyFindings(question: string, groupedContext: Map<string, { title: string; snippets: string[] }>): Promise<string | null> {
    if (groupedContext.size === 0) return null

    let contextBlob = ''
    for (const [_, data] of groupedContext) {
      contextBlob += `Thread: ${data.title}\n${data.snippets.join('\n')}\n\n`
    }

    const extractionPrompt = `
Extract the most important specific facts, numbers, or technical details from the following conversations that are relevant to the question: "${question}"
Focus on "Atomic Facts".
Context:
${contextBlob}

Return as a bulleted list of findings. If nothing relevant, return "None".
`
    try {
      const findings = await this.ollamaClient.generate(extractionPrompt)
      return findings.trim() === 'None' ? null : findings
    } catch (_err) {
      return null
    }
  }

  private groupChunksByParentThread(chunks: VectorSearchResult[]): Map<string, { title: string; path: string; snippets: string[] }> {
    const threadGroups = new Map<string, { title: string; path: string; snippets: string[] }>()
    for (const chunk of chunks) {
      const threadPath = chunk.meta['path']!
      if (!threadGroups.has(threadPath)) {
        threadGroups.set(threadPath, { title: chunk.meta['title']!, path: threadPath, snippets: [] })
      }
      const group = threadGroups.get(threadPath)!
      if (!group.snippets.includes(chunk.meta['snippet']!)) group.snippets.push(chunk.meta['snippet']!)
    }
    return threadGroups
  }

  private constructAdvancedRagPrompt(question: string, groupedContext: Map<string, { title: string; snippets: string[] }>, intent: string, keyFindings: string | null): string {
    let contextDescription = ''
    let sourceIndex = 1
    for (const [_, data] of groupedContext) {
      contextDescription += `### Thread [${sourceIndex}]: ${data.title}\n`
      data.snippets.forEach(s => { contextDescription += `- ${s}\n` })
      contextDescription += '\n'
      sourceIndex++
    }

    const findingsSection = keyFindings ? `KEY FINDINGS FROM HISTORY:\n${keyFindings}\n\n` : ''

    const modeInstructions = intent === 'broad'
      ? 'Provide a thematic summary across these conversations. Group by thread and provide a recap for each.'
      : 'Provide a direct, high-fidelity answer based on the context and key findings.'

    return `
You are a high-level personal knowledge assistant. Synthesize the provided history.

${findingsSection}RAW CONTEXT:
${contextDescription || 'No history found.'}

QUESTION: ${question}

INSTRUCTIONS:
1. ${modeInstructions}
2. Prioritize "Key Findings" for specific details.
3. Cross-reference threads if related.
4. Cite using [Thread N].

ANSWER:`
  }

  private displaySourceThreads(groupedContext: Map<string, { title: string; path: string }>): void {
    console.log(`\n${chalk.bold.cyan('Found in Conversations:')}`)
    let index = 1
    for (const [_, data] of groupedContext) {
      console.log(`[Thread ${index}] ${data.title} (${chalk.gray(data.path)})`)
      index++
    }
    console.log('')
  }
}
