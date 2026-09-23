import { tool } from '@opencode-ai/plugin'
import { setStatusFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memorySetStatusTool = tool({
  description: "Set a memory's lifecycle status.",
  args: {
    id: tool.schema.number().describe('Memory ID'),
    status: tool.schema.enum(['active', 'archived']).describe('Status to set'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const updated = await setStatusFull(db, args.id, args.status)
    if (!updated) return { output: JSON.stringify({ error: `memory ${args.id} not found` }) }
    return { output: JSON.stringify({ ok: true, id: args.id }) }
  },
})
