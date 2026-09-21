const PHASE_RE = /\[PHASE:\s*([A-Z]+)\]/gi

const sessionPhases = new Map<string, { phase: string; updatedAt: number }>()

export function getCurrentPhase(sessionId: string): string | undefined {
  return sessionPhases.get(sessionId)?.phase
}

export function updatePhaseFromMessages(
  sessionId: string,
  messages:
    | Array<{ content?: unknown; parts?: Array<{ type?: string; text?: string }> }>
    | undefined
): void {
  if (!Array.isArray(messages)) return
  let latestPhase: string | undefined
  let latestIndex = -1

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const parts = msg.parts
    if (!Array.isArray(parts)) continue

    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        const match = part.text.match(PHASE_RE)
        if (match) {
          latestPhase = match[1]
          latestIndex = i
        }
      }
    }
  }

  if (latestPhase && latestIndex >= 0) {
    sessionPhases.set(sessionId, { phase: latestPhase, updatedAt: Date.now() })
  }
}
