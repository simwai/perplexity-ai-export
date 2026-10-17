const SUCCESS_SIGNALS = [
  /\bfixed\b/i,
  /\bpassing\b/i,
  /\bworks\b(?:\s+now)?\b/i,
  /\bresolved\b/i,
  /\bdone\b/i,
  /\bcompleted?\b/i,
  /\bsuccess\b/i,
  /\bworking\b/i,
  /\bmerged?\b/i,
  /\bverified\b/i,
  /\bconfirmed\b/i,
  /\bclosed?\b/i,
  /\bshipped?\b/i,
]

const FAILURE_SIGNALS = [
  /\bfail(?:s|ed|ure)?\b/i,
  /\bbroken\b/i,
  /\berror\b/i,
  /\bregression\b/i,
  /\bnot\s+working\b/i,
  /\bstill\s+broken\b/i,
  /\bdoesn'?t\s+work\b/i,
  /\bcrashes?\b/i,
  /\btimeout\b/i,
  /\bincorrect\b/i,
  /\bbug\b/i,
]

export function detectOutcome(text: string): boolean | null {
  const hasSuccess = SUCCESS_SIGNALS.some((re) => re.test(text))
  const hasFailure = FAILURE_SIGNALS.some((re) => re.test(text))
  if (hasSuccess && !hasFailure) return true
  if (hasFailure && !hasSuccess) return false
  return null
}

export function classifyOutcome(text: string): 'success' | 'failure' | 'inconclusive' {
  const outcome = detectOutcome(text)
  if (outcome === true) return 'success'
  if (outcome === false) return 'failure'
  return 'inconclusive'
}

export function isOutcomeSignal(text: string): boolean {
  return detectOutcome(text) !== null
}
