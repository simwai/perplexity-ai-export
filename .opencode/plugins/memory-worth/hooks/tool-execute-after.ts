import type { Client } from '@libsql/client'
import { asNumber } from '../db/decode.js'
import { applyOutcome, resolveEpisode } from '../db/queries.js'
import { classifyOutcome, isOutcomeSignal } from '../outcome.js'

export async function resolveSessionOutcome(
  db: Client,
  sessionId: string,
  outputText: string
): Promise<{ resolved: boolean }> {
  if (!isOutcomeSignal(outputText)) return { resolved: false }
  const outcome = classifyOutcome(outputText) === 'success'
  const retrieved = await db.execute({
    sql: `SELECT ce.memory_id AS memory_id FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.session_id = ? AND e.resolved_at IS NULL`,
    args: [sessionId],
  })
  for (const row of retrieved.rows) {
    const memoryId = asNumber(row['memory_id'])
    if (memoryId) await applyOutcome(db, memoryId, outcome)
  }
  await resolveEpisode(db, sessionId, outcome)
  return { resolved: true }
}
