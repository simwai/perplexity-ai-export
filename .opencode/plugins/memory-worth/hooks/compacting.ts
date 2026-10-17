import type { Client } from '@libsql/client'
import { asNumber, asText } from '../db/decode.js'

export async function buildCompactionContext(db: Client, sessionId: string): Promise<string[]> {
  const currents = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.mw AS mw FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active' ORDER BY m.mw DESC, m.usage_count DESC LIMIT 5`,
    args: [],
  })
  const lines: string[] = [
    `memory-worth: ${currents.rows.length} top memories preserved across compaction for session ${sessionId}.`,
  ]
  for (const row of currents.rows) {
    lines.push(
      `memory ${asNumber(row['id'])} (mw ${asNumber(row['mw'])}): ${asText(row['content']).slice(0, 120)}`
    )
  }
  return lines
}
