import { tool } from '@opencode-ai/plugin'
import { getMemory } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memorySynthesizeTool = tool({
  description:
    'Combine multiple memories into a synthesized insight draft. Returns a draft without writing.',
  args: {
    memory_ids: tool.schema.array(tool.schema.number()).describe('IDs of memories to synthesize'),
  },
  async execute(args, context) {
    if (args.memory_ids.length < 2)
      return { output: 'Error: at least 2 memory IDs required for synthesis' }
    const db = await getToolDb(context.directory)
    const loaded = await Promise.all(args.memory_ids.map((id) => getMemory(db, id)))
    const present = loaded.filter((m): m is NonNullable<typeof m> => m !== null)
    if (present.length < 2)
      return { output: 'Error: at least 2 existing memories required for synthesis' }

    const parts: string[] = []
    for (const item of present) {
      parts.push(
        `[id=${item.id} trust=${item.trust_label} score=${item.trust_score}] ${item.content}`
      )
    }
    return {
      output: JSON.stringify({
        synthesized: true,
        draft: parts.join('\n\n---\n\n'),
        input_ids: present.map((m) => m.id),
        suggestion:
          'Review the draft, then use memory_write to store the synthesis and memory_merge to consolidate sources.',
      }),
    }
  },
})
