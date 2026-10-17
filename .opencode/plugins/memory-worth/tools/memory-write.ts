import { tool } from '@opencode-ai/plugin'
import { findDuplicateFull, writeMemoryFull } from '../db/queries.js'
import { getToolDb } from './get-db.js'

const groundSchema = tool.schema.object({
  kind: tool.schema.string().describe('Ground kind: file, symbol, or git_ref'),
  value: tool.schema.string().describe('Ground value'),
  fingerprint: tool.schema.string().optional().describe('Content fingerprint'),
})

export const memoryWriteTool = tool({
  description:
    'Store a piece of knowledge in persistent memory. Requires applies_when. Refuses exact duplicates.',
  args: {
    content: tool.schema.string().describe('The knowledge to store'),
    applies_when: tool.schema.string().describe('When this memory applies (required)'),
    tags: tool.schema.array(tool.schema.string()).optional().describe('Tags'),
    task_type: tool.schema.string().optional().describe('Task type bucket (default general)'),
    scope: tool.schema.string().optional().describe('Scope as project or project/topic'),
    tier: tool.schema.enum(['L1', 'L2', 'L3']).optional().describe('Tier (default L1)'),
    memory_type: tool.schema
      .enum(['convention', 'decision', 'bugfix', 'error', 'reference', 'note'])
      .optional()
      .describe('Memory type'),
    source: tool.schema
      .enum(['session', 'file', 'tool', 'user', 'agent'])
      .optional()
      .describe('Source'),
    grounds: tool.schema.array(groundSchema).optional().describe('Grounds'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const duplicate = await findDuplicateFull(db, args.content)
    if (duplicate !== null) {
      return { output: JSON.stringify({ error: `duplicate_of:${duplicate}` }) }
    }
    let project: string | undefined
    let topic: string | undefined
    if (args.scope) {
      const slash = args.scope.indexOf('/')
      if (slash < 0) {
        project = args.scope
      } else {
        project = args.scope.slice(0, slash)
        topic = args.scope.slice(slash + 1)
      }
    }
    try {
      const stored = await writeMemoryFull(db, {
        content: args.content,
        applies_when: args.applies_when,
        tags: args.tags,
        grounds: args.grounds,
        taskType: args.task_type,
        memoryType: args.memory_type,
        tier: args.tier,
        source: args.source,
        project,
        topic,
      })
      return { output: JSON.stringify({ id: stored.id }) }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'write failed'
      return { output: JSON.stringify({ error: message }) }
    }
  },
})
