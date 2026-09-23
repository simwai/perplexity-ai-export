import { tool } from '@opencode-ai/plugin'
import { deleteMemoryFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryDeleteTool = tool({
  description:
    'Permanently delete a memory. Tag links and grounds cascade; calibration history is preserved.',
  args: {
    id: tool.schema.number().describe('Memory ID to delete'),
    reason: tool.schema.string().optional().describe('Why this memory is deleted'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const deleted = await deleteMemoryFull(db, args.id)
    if (!deleted) return { output: JSON.stringify({ error: `memory ${args.id} not found` }) }
    if (args.reason !== undefined) {
      return { output: JSON.stringify({ ok: true, id: args.id, reason: args.reason }) }
    }
    return { output: JSON.stringify({ ok: true, id: args.id }) }
  },
})
