import { tool } from '@opencode-ai/plugin'
import { searchMemories } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memorySearchTool = tool({
  description:
    'Search memories by free-text query. Returns ranked results with trust labels (high/neutral/low/unproven).',
  args: {
    query: tool.schema.string().describe('Search query'),
    task_type: tool.schema.string().optional().describe('Filter by task type bucket'),
    limit: tool.schema.number().optional().describe('Max results (default 10)'),
  },
  async execute(args, context) {
    const query = args.query.trim()
    if (!query) return { output: 'Error: query is required' }
    const db = await getToolDb(context.directory)
    const results = await searchMemories(
      db,
      query,
      args.limit ?? 10,
      args.task_type,
      context.sessionID
    )
    return { output: JSON.stringify(results) }
  },
})
