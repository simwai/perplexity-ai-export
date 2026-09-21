import { tool } from '@opencode-ai/plugin'
import { epochNow } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memoryDeleteTool = tool({
  description: 'Permanently delete a memory.',
  args: {
    id: tool.schema.number().describe('Memory ID to delete'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const existing = await db.execute({
      sql: `SELECT id FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.id],
    })
    if (existing.rows.length === 0) return { output: `Error: Memory ${args.id} not found` }

    await db.execute({
      sql: `UPDATE memory SET deleted_at = ? WHERE id = ?`,
      args: [epochNow(), args.id],
    })
    return { output: JSON.stringify({ deleted: true, id: args.id }) }
  },
})
