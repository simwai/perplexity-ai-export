import { tool } from '@opencode-ai/plugin'
import { invalidateMemoryFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryInvalidateTool = tool({
  description:
    'Mark a memory as invalidated with a reason. Modes correct and replace retire it; supplement acknowledges without changing status.',
  args: {
    id: tool.schema.number().describe('Memory ID to invalidate'),
    reason: tool.schema.string().describe('Why this memory is invalid'),
    mode: tool.schema.enum(['correct', 'supplement', 'replace']).describe('Invalidation mode'),
  },
  async execute(args, context) {
    if (!args.reason.trim()) return { output: JSON.stringify({ error: 'reason is required' }) }
    const db = await getToolDb(context.directory)
    if (args.mode === 'supplement') {
      return { output: JSON.stringify({ ok: true, id: args.id, mode: args.mode, unchanged: true }) }
    }
    const invalidated = await invalidateMemoryFull(db, args.id)
    if (!invalidated) return { output: JSON.stringify({ error: `memory ${args.id} not found` }) }
    return { output: JSON.stringify({ ok: true, id: args.id }) }
  },
})
