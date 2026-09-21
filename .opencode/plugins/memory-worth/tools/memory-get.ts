import { tool } from '@opencode-ai/plugin'
import { getMemory } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryGetTool = tool({
  description: 'Retrieve a single memory by ID with full trust metadata.',
  args: {
    id: tool.schema.number().describe('Memory ID to retrieve'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const memory = await getMemory(db, args.id)
    if (!memory) return { output: `Error: Memory ${args.id} not found` }
    return { output: JSON.stringify(memory) }
  },
})
