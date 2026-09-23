import { tool } from '@opencode-ai/plugin'
import { asNumber, asText } from '../db/decode.js'
import { getParameter, labelMemory, searchMemoriesFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

function parseScope(scope: string | undefined): { project?: string; topic?: string } {
  if (!scope) return {}
  const slash = scope.indexOf('/')
  if (slash < 0) return { project: scope }
  return { project: scope.slice(0, slash), topic: scope.slice(slash + 1) }
}

export const memorySearchTool = tool({
  description:
    'Search memories by free-text query. Returns ranked results with quantile trust labels.',
  args: {
    query: tool.schema.string().describe('Search query'),
    strategy: tool.schema
      .enum(['metadata', 'snippet', 'full'])
      .optional()
      .describe('Result shape (default full)'),
    scope: tool.schema.string().optional().describe('Scope as project or project/topic'),
    tier: tool.schema.enum(['L1', 'L2', 'L3']).optional().describe('Filter by tier'),
  },
  async execute(args, context) {
    const query = args.query.trim()
    if (!query) return { output: JSON.stringify({ error: 'query is required' }) }
    const db = await getToolDb(context.directory)
    const strategy = args.strategy ?? 'full'
    const scope = parseScope(args.scope)
    const hits = await searchMemoriesFull(db, query, {
      project: scope.project,
      topic: scope.topic,
      tier: args.tier,
      limit: 10,
      sessionId: context.sessionID,
    })
    const windowRaw = Number(await getParameter(db, 'window_size', '50'))
    const windowSize = Number.isFinite(windowRaw) ? Math.max(1, Math.floor(windowRaw)) : 50
    const sliced = hits.slice(0, Math.min(hits.length, windowSize))
    const results: unknown[] = []
    for (const hit of sliced) {
      const detail = await db.execute({
        sql: `SELECT s_plus, s_minus FROM memory WHERE id = ?`,
        args: [hit.id],
      })
      const sPlus = asNumber(detail.rows[0]?.['s_plus'])
      const sMinus = asNumber(detail.rows[0]?.['s_minus'])
      const trust_label = await labelMemory(db, hit.mw, sPlus, sMinus)
      if (strategy === 'metadata') {
        results.push({ id: hit.id, mw: hit.mw, trust_label, task_type: hit.task_type })
        continue
      }
      if (strategy === 'snippet') {
        results.push({
          id: hit.id,
          mw: hit.mw,
          trust_label,
          task_type: hit.task_type,
          snippet: hit.content.slice(0, 280),
        })
        continue
      }
      const full = await db.execute({
        sql: `SELECT m.applies_when AS applies_when, m.usage_count AS usage_count FROM memory m WHERE m.id = ?`,
        args: [hit.id],
      })
      const tags = await db.execute({
        sql: `SELECT t.name AS name FROM tag t JOIN memory_tag mt ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name`,
        args: [hit.id],
      })
      const tagNames: string[] = []
      for (const row of tags.rows) {
        tagNames.push(asText(row['name']))
      }
      results.push({
        id: hit.id,
        content: hit.content,
        applies_when: String(full.rows[0]?.['applies_when'] ?? ''),
        mw: hit.mw,
        trust_label,
        usage_count: asNumber(full.rows[0]?.['usage_count']),
        tags: tagNames,
        task_type: hit.task_type,
      })
    }
    return { output: JSON.stringify(results) }
  },
})
