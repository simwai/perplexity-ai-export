import type { Client } from '@libsql/client'
import { asText } from '../db/decode.js'
import { getStatsFull, searchMemoriesFull } from '../db/queries.js'

export async function buildInjectionTexts(
  db: Client,
  sessionId: string,
  isFirst: boolean
): Promise<string[]> {
  if (!isFirst) return []
  const stats = await getStatsFull(db)
  const hits = await searchMemoriesFull(db, 'memory', { limit: 5, sessionId })
  const lines: string[] = []
  lines.push(
    `memory-worth session digest: ${stats.total} memories, ${stats.unresolved_episodes} unresolved episodes.`
  )
  for (const hit of hits) {
    const tags = await db.execute({
      sql: `SELECT t.name AS name FROM tag t JOIN memory_tag mt ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name LIMIT 3`,
      args: [hit.id],
    })
    const names: string[] = []
    for (const row of tags.rows) {
      names.push(asText(row['name']))
    }
    lines.push(
      `memory ${hit.id} (mw ${Math.round(hit.mw * 100) / 100}, ${hit.task_type}${names.length > 0 ? `, ${names.join(',')}` : ''}): ${hit.content.slice(0, 160)}`
    )
  }
  return lines
}
