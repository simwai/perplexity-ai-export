import type { SearchResult } from './core/types.js'

export function buildMemoryPromptFragment(memories: ReadonlyArray<SearchResult>): string {
  if (memories.length === 0) return ''

  const lines: string[] = []
  for (let i = 0; i < memories.length; i++) {
    const item = memories[i]
    if (!item) continue
    let confidence = 'neutral'
    if (item.trust_score >= 0.7) confidence = 'high'
    else if (item.trust_score <= 0.3) confidence = 'low'
    lines.push(
      `[${i + 1}] (trust: ${item.trust_label}, confidence: ${confidence})\n${item.content}`
    )
  }

  return `\n\n--- Persistent memories (${memories.length}) ---\n${lines.join('\n\n')}\n--- End memories ---\n`
}
