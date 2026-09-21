import { tool } from '@opencode-ai/plugin'
import { epochNow } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memoryInvalidateTool = tool({
  description:
    'Mark a memory as invalidated. Invalidated memories are excluded from search results.',
  args: {
    id: tool.schema.number().describe('Memory ID to invalidate'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const existing = await db.execute({
      sql: `SELECT id FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.id],
    })
    if (existing.rows.length === 0) return { output: `Error: Memory ${args.id} not found` }

    await db.execute({
      sql: `UPDATE memory SET memory_status_id = (SELECT id FROM memory_status WHERE name = 'invalidated'), updated_at = ? WHERE id = ?`,
      args: [epochNow(), args.id],
    })
    return { output: JSON.stringify({ invalidated: true, id: args.id }) }
  },
})
