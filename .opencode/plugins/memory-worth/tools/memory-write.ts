import { tool } from '@opencode-ai/plugin'
import { writeMemory } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryWriteTool = tool({
  description:
    'Store a piece of knowledge in persistent memory. Searches for near-duplicates before writing.',
  args: {
    content: tool.schema.string().describe('The knowledge to store'),
    tags: tool.schema.string().optional().describe('Comma-separated tags'),
    task_type: tool.schema.string().optional().describe('Task type bucket (default: general)'),
  },
  async execute(args, context) {
    const content = args.content.trim()
    if (!content) return { output: 'Error: content is required' }
    const db = await getToolDb(context.directory)
    const result = await writeMemory(
      db,
      { content, tags: args.tags, task_type: args.task_type },
      args.task_type ?? 'general',
      'active'
    )
    return { output: JSON.stringify({ stored: true, ...result }) }
  },
})
