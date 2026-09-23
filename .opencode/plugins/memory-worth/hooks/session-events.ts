import type { Client } from '@libsql/client'
import { asNumber } from '../db/decode.js'
import { ensureTaskType } from '../db/queries.js'

export async function handleSessionCreated(db: Client): Promise<void> {
  await ensureTaskType(db, 'general')
}

export async function handleSessionIdle(
  db: Client,
  sessionId: string
): Promise<{ discarded: number; kept: number }> {
  const open = await db.execute({
    sql: `SELECT id FROM episode WHERE session_id = ? AND resolved_at IS NULL`,
    args: [sessionId],
  })
  let discarded = 0
  let kept = 0
  for (const row of open.rows) {
    const episodeId = asNumber(row['id'])
    const entries = await db.execute({
      sql: `SELECT id FROM calibration_entry WHERE episode_id = ? LIMIT 1`,
      args: [episodeId],
    })
    if (entries.rows.length === 0) {
      await db.execute({ sql: `DELETE FROM episode WHERE id = ?`, args: [episodeId] })
      discarded += 1
    } else {
      kept += 1
    }
  }
  return { discarded, kept }
}

export async function handleSessionCompacted(
  db: Client,
  sessionId: string
): Promise<{ unresolved_entries: number }> {
  const rows = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.session_id = ? AND e.resolved_at IS NULL`,
    args: [sessionId],
  })
  return { unresolved_entries: asNumber(rows.rows[0]?.['cnt']) }
}
