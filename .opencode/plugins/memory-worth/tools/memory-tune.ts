import { tool } from '@opencode-ai/plugin'
import { ensureTaskType, getParameter, setParameter } from '../db/queries.js'
import { getToolDb } from './get-db.js'

const KNOBS = [
  'trust_q',
  'doubt_q',
  'min_evidence',
  'active_partition',
  'tune_interval',
  'window_size',
] as const

type Knob = (typeof KNOBS)[number]

function validateKnob(knob: Knob, value: string, current: Record<Knob, string>): string | null {
  switch (knob) {
    case 'trust_q':
    case 'doubt_q': {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 1)
        return `${knob} must be between 0 and 1 (exclusive)`
      const other = knob === 'trust_q' ? Number(current['doubt_q']) : Number(current['trust_q'])
      if (knob === 'trust_q' && numeric <= other)
        return `trust_q (${numeric}) must exceed doubt_q (${other})`
      if (knob === 'doubt_q' && numeric >= other)
        return `doubt_q (${numeric}) must stay below trust_q (${other})`
      return null
    }
    case 'min_evidence':
    case 'tune_interval':
    case 'window_size': {
      const numeric = Number(value)
      if (!Number.isInteger(numeric) || numeric < 1) return `${knob} must be a positive integer`
      return null
    }
    case 'active_partition':
      return value.trim().length > 0 ? null : 'active_partition requires a non-empty name'
  }
}

export const memoryTuneTool = tool({
  description:
    'Adjust a tuning knob. Requires a written rationale. Every change is audited and reversible.',
  args: {
    knob: tool.schema
      .enum([
        'trust_q',
        'doubt_q',
        'min_evidence',
        'active_partition',
        'tune_interval',
        'window_size',
      ])
      .describe('Knob name'),
    value: tool.schema.string().describe('New value as text'),
    rationale: tool.schema.string().min(10).describe('One-sentence explanation for this change'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const current: Record<Knob, string> = {
      trust_q: await getParameter(db, 'trust_q', '0.70'),
      doubt_q: await getParameter(db, 'doubt_q', '0.30'),
      min_evidence: await getParameter(db, 'min_evidence', '3'),
      active_partition: await getParameter(db, 'active_partition', 'auto'),
      tune_interval: await getParameter(db, 'tune_interval', '50'),
      window_size: await getParameter(db, 'window_size', '50'),
    }
    const problem = validateKnob(args.knob, args.value.trim(), current)
    if (problem !== null) return { output: JSON.stringify({ error: problem }) }
    if (args.knob === 'active_partition' && args.value.trim() !== 'auto') {
      await ensureTaskType(db, args.value.trim())
    }
    const applied = await setParameter(db, args.knob, args.value.trim(), args.rationale.trim())
    const warnings: string[] = []
    if (args.knob === 'tune_interval' && Number(args.value) < 10) {
      warnings.push('tune_interval below 10 invites thrash; stage changes deliberately')
    }
    if (args.knob === 'min_evidence' && Number(args.value) > 100) {
      warnings.push('min_evidence above 100 keeps most memories unproven for a long time')
    }
    return {
      output: JSON.stringify({ applied: true, previous: applied.previous ?? null, warnings }),
    }
  },
})
