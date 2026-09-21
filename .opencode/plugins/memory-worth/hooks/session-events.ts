import type { Client } from '@libsql/client'
import { ensureTaskType } from '../db/queries.js'
import { epochNow } from '../db/epoch.js'

export async function handleSessionCreated(db: Client): Promise<void> {
  await ensureTaskType(db, 'general')
  await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO tuning_param (key, value, updated_at) VALUES ('decay_rate', '0.3', ?)`,
        args: [epochNow()],
      },
      {
        sql: `INSERT OR IGNORE INTO tuning_param (key, value, updated_at) VALUES ('trust_quantile', '0.3', ?)`,
        args: [epochNow()],
      },
      {
        sql: `INSERT OR IGNORE INTO tuning_param (key, value, updated_at) VALUES ('doubt_quantile', '0.3', ?)`,
        args: [epochNow()],
      },
      {
        sql: `INSERT OR IGNORE INTO tuning_param (key, value, updated_at) VALUES ('min_evidence', '5', ?)`,
        args: [epochNow()],
      },
      {
        sql: `INSERT OR IGNORE INTO tuning_param (key, value, updated_at) VALUES ('active_partition', 'general', ?)`,
        args: [epochNow()],
      },
    ],
    'write'
  )
}

export async function handleSessionDeleted(db: Client, sessionId: string): Promise<void> {
  await db.execute({ sql: `DELETE FROM session_memory WHERE session_id = ?`, args: [sessionId] })
}
