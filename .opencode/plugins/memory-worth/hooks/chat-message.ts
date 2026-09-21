import type { Client } from '@libsql/client'
import { searchMemories } from '../db/queries.js'

export async function injectMemories(
  db: Client,
  prompt: string,
  sessionId: string,
  maxMemories: number = 5
): Promise<string> {
  const memories = await searchMemories(db, prompt, maxMemories, undefined, sessionId)
  if (memories.length === 0) return prompt

  const blocks: string[] = []
  for (let i = 0; i < memories.length; i++) {
    const item = memories[i]
    if (!item) continue
    blocks.push(
      `[MEMORY ${i + 1}] trust=${item.trust_label} score=${item.trust_score} evidence=${item.evidence_count}\n${item.content}`
    )
  }
  return `${prompt}\n\n--- Relevant memories ---\n${blocks.join('\n\n')}\n--- End memories ---`
}
