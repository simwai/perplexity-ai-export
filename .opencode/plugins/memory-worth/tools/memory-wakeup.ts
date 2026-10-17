import { tool } from '@opencode-ai/plugin'
import { asNumber, asText } from '../db/decode.js'
import { daysAgo } from '../db/epoch.js'
import { getStatsFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryWakeupTool = tool({
  description:
    'Session-start digest: health counts, unresolved episodes, stale and unproven memories.',
  args: {},
  async execute(_args, context) {
    const db = await getToolDb(context.directory)
    const stats = await getStatsFull(db)
    const staleRows = await db.execute({
      sql: `SELECT m.id AS id, m.content AS content, m.updated_at AS updated_at FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active' AND m.updated_at < ? ORDER BY m.updated_at ASC LIMIT 5`,
      args: [Number(daysAgo(7))],
    })
    const stale: Array<{ id: number; snippet: string; updated_at: number }> = []
    for (const row of staleRows.rows) {
      stale.push({
        id: asNumber(row['id']),
        snippet: asText(row['content']).slice(0, 160),
        updated_at: asNumber(row['updated_at']),
      })
    }
    const unproven = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active' AND (m.s_plus + m.s_minus) < CAST((SELECT value FROM parameter WHERE key = 'min_evidence') AS REAL)`,
      args: [],
    })
    return {
      output: JSON.stringify({
        total: stats.total,
        by_status: stats.by_status,
        avg_mw: Math.round(stats.avg_mw * 1000) / 1000,
        unresolved_episodes: stats.unresolved_episodes,
        stale,
        unproven: asNumber(unproven.rows[0]?.['cnt']),
      }),
    }
  },
})
