import { tool } from '@opencode-ai/plugin'
import { updateMemoryFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryUpdateTool = tool({
  description: "Update a memory's content and tags. Preserves accumulated trust counters.",
  args: {
    id: tool.schema.number().describe('Memory ID to update'),
    content: tool.schema.string().describe('New content'),
    tags: tool.schema.array(tool.schema.string()).optional().describe('Replacement tags'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    try {
      const updated = await updateMemoryFull(db, args.id, args.content, args.tags)
      if (!updated) return { output: JSON.stringify({ error: `memory ${args.id} not found` }) }
      return { output: JSON.stringify({ ok: true, id: args.id }) }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'update failed'
      return { output: JSON.stringify({ error: message }) }
    }
  },
})
