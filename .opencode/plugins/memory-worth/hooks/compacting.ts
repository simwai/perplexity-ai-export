import type { Client } from '@libsql/client'

export async function handleCompacting(db: Client, sessionId: string): Promise<void> {
  await db.execute({ sql: `DELETE FROM session_memory WHERE session_id = ?`, args: [sessionId] })
}
