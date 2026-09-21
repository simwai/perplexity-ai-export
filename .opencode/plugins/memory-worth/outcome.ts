import { detectOutcome } from './hooks/tool-execute-after.js'

export function classifyOutcome(text: string): 'success' | 'failure' | 'inconclusive' {
  const outcome = detectOutcome(text)
  if (outcome === true) return 'success'
  if (outcome === false) return 'failure'
  return 'inconclusive'
}

export function isOutcomeSignal(text: string): boolean {
  return detectOutcome(text) !== null
}
