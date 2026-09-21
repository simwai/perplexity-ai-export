import { tool } from '@opencode-ai/plugin'
import { asNumber, asText } from '../db/decode.js'
import { daysAgo } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memoryWakeupTool = tool({
  description: 'Surface stale but potentially relevant memories for re-evaluation.',
  args: {
    min_age_days: tool.schema.number().optional().describe('Minimum age in days (default 7)'),
    max_results: tool.schema.number().optional().describe('Max results (default 20)'),
  },
  async execute(args, context) {
    const minAge = args.min_age_days ?? 7
    const maxResults = Math.max(1, Math.min(args.max_results ?? 20, 50))
    const db = await getToolDb(context.directory)

    const result = await db.execute({
      sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.updated_at AS updated_at FROM memory m JOIN memory_status ms ON m.memory_status_id = ms.id WHERE m.deleted_at IS NULL AND ms.name = 'active' AND CAST(m.updated_at AS INTEGER) < CAST(? AS INTEGER) ORDER BY m.updated_at ASC LIMIT ?`,
      args: [daysAgo(minAge), maxResults],
    })

    const memories: Array<{
      id: number
      content: string
      trust_score: number
      evidence_count: number
      updated_at: string
    }> = []
    for (const row of result.rows) {
      const success = asNumber(row['ema_success'])
      const failure = asNumber(row['ema_failure'])
      const total = success + failure
      const score = total === 0 ? 0.5 : success / total
      memories.push({
        id: asNumber(row['id']),
        content: asText(row['content']),
        trust_score: Math.round(score * 100) / 100,
        evidence_count: asNumber(row['evidence_count']),
        updated_at: asText(row['updated_at']),
      })
    }
    return { output: JSON.stringify({ memories, min_age_days: minAge }) }
  },
})
