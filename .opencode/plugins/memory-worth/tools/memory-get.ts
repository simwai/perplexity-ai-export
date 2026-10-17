import { tool } from '@opencode-ai/plugin'
import { getMemoryFull, labelMemory } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryGetTool = tool({
  description: 'Retrieve a single memory by ID with full trust metadata.',
  args: {
    id: tool.schema.number().describe('Memory ID to retrieve'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const memory = await getMemoryFull(db, args.id)
    if (!memory) return { output: JSON.stringify({ error: `memory ${args.id} not found` }) }
    const trust_label = await labelMemory(db, memory.mw, memory.s_plus, memory.s_minus)
    return { output: JSON.stringify({ ...memory, trust_label }) }
  },
})
