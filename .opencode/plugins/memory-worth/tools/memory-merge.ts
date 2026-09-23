import { tool } from '@opencode-ai/plugin'
import { getMemoryFull, mergeMemoriesFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryMergeTool = tool({
  description:
    'Merge id_b into id_a with explicit merged content. Combines support counters; id_b is archived.',
  args: {
    id_a: tool.schema.number().describe('ID of the memory to keep'),
    id_b: tool.schema.number().describe('ID of the memory to merge away'),
    merged_content: tool.schema.string().describe('Explicit merged content'),
  },
  async execute(args, context) {
    if (args.id_a === args.id_b) {
      return { output: JSON.stringify({ error: 'id_a and id_b must differ' }) }
    }
    if (!args.merged_content.trim()) {
      return { output: JSON.stringify({ error: 'merged_content is required' }) }
    }
    const db = await getToolDb(context.directory)
    try {
      const merged = await mergeMemoriesFull(db, args.id_a, [args.id_b], args.merged_content.trim())
      if (!merged.removed.includes(args.id_b)) {
        return { output: JSON.stringify({ error: `memory ${args.id_b} not found` }) }
      }
      const kept = await getMemoryFull(db, merged.kept)
      return {
        output: JSON.stringify({
          kept: merged.kept,
          removed: args.id_b,
          merged_mw: kept?.mw ?? 0.5,
        }),
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'merge failed'
      return { output: JSON.stringify({ error: message }) }
    }
  },
})
