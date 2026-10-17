import { tool } from '@opencode-ai/plugin'
import { searchMemoriesFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

function queryTerms(query: string): string[] {
  const terms: string[] = []
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 2 && !terms.includes(raw)) terms.push(raw)
  }
  return terms
}

export const memorySynthesizeTool = tool({
  description: 'Answer a query from stored memories with citations plus an explicit unknowns list.',
  args: {
    query: tool.schema.string().describe('Question to answer from memory'),
  },
  async execute(args, context) {
    const query = args.query.trim()
    if (!query) return { output: JSON.stringify({ error: 'query is required' }) }
    const db = await getToolDb(context.directory)
    const hits = await searchMemoriesFull(db, query, { limit: 5, sessionId: context.sessionID })
    const cited: Array<{ id: number; content: string; mw: number }> = []
    for (const hit of hits) {
      cited.push({ id: hit.id, content: hit.content, mw: hit.mw })
    }
    const covered = cited.map((item) => item.content.toLowerCase()).join('\n')
    const unknowns: string[] = []
    for (const term of queryTerms(query)) {
      if (!covered.includes(term)) unknowns.push(term)
    }
    return { output: JSON.stringify({ cited, unknowns }) }
  },
})
