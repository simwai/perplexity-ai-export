import { tool } from '@opencode-ai/plugin'
import { asNumber } from '../db/decode.js'
import { epochNow } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memorySetStatusTool = tool({
  description: "Set a memory's status: active, archived, invalidated, or merged.",
  args: {
    id: tool.schema.number().describe('Memory ID'),
    status: tool.schema
      .enum(['active', 'archived', 'invalidated', 'merged'])
      .describe('Status to set'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const existing = await db.execute({
      sql: `SELECT id FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.id],
    })
    if (existing.rows.length === 0) return { output: `Error: Memory ${args.id} not found` }

    const statusRow = await db.execute({
      sql: `SELECT id FROM memory_status WHERE name = ?`,
      args: [args.status],
    })
    if (statusRow.rows.length === 0)
      return { output: `Error: status "${args.status}" not found in lookup table` }
    const statusId = asNumber(statusRow.rows[0]?.['id'])

    await db.execute({
      sql: `UPDATE memory SET memory_status_id = ?, updated_at = ? WHERE id = ?`,
      args: [statusId, epochNow(), args.id],
    })
    return { output: JSON.stringify({ set_status: true, id: args.id, status: args.status }) }
  },
})
