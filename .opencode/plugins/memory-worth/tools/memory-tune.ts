import { tool } from '@opencode-ai/plugin'
import { getTuningParams } from '../db/queries.js'
import {
  DEFAULT_TUNING_PARAMS,
  createAuditEntry,
  validateTuningParams,
} from '../core/governance.js'
import { isErr } from '../core/result.js'
import { epochNow } from '../db/epoch.js'
import { ensureTaskType } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryTuneTool = tool({
  description: 'Adjust a tuning knob. Requires a written rationale. Only one knob per call.',
  args: {
    knob: tool.schema
      .enum(['decay_rate', 'trust_quantile', 'doubt_quantile', 'min_evidence', 'active_partition'])
      .describe('Knob name'),
    value: tool.schema.string().describe('New value as text (numbers parse to numeric knobs)'),
    rationale: tool.schema.string().min(10).describe('One-sentence explanation for this change'),
  },
  async execute(args, context) {
    const db = await getToolDb(context.directory)
    const current = await getTuningParams(db)
    const oldValues: Record<string, unknown> = { ...current }

    let parsed: string | number = args.value.trim()
    if (args.knob !== 'active_partition') {
      const numeric = Number(args.value)
      if (!Number.isFinite(numeric))
        return { output: `Error: knob "${args.knob}" requires a numeric value` }
      parsed = numeric
    } else if (!parsed) {
      return { output: 'Error: active_partition requires a non-empty partition name' }
    }

    const updates: Record<string, unknown> = { [args.knob]: parsed }
    const validation = validateTuningParams(updates as Partial<typeof DEFAULT_TUNING_PARAMS>)
    if (isErr(validation)) return { output: `Error: ${validation.error}` }

    if (args.knob === 'active_partition' && typeof parsed === 'string') {
      await ensureTaskType(db, parsed)
    }

    const now = epochNow()
    const stored = typeof parsed === 'number' ? String(parsed) : parsed
    await db.execute({
      sql: `INSERT INTO tuning_param (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [args.knob, stored, now],
    })

    const audit = createAuditEntry('agent', args.rationale.trim(), oldValues, updates)
    const inserted = await db.execute({
      sql: `INSERT INTO tuning_audit (changed_at, changed_by, rationale) VALUES (?, ?, ?)`,
      args: [audit.changed_at, audit.changed_by, audit.rationale],
    })
    const auditIdRaw = inserted.lastInsertRowid
    const auditId = typeof auditIdRaw === 'bigint' ? Number(auditIdRaw) : 0
    await db.execute({
      sql: `INSERT INTO tuning_audit_entry (audit_id, param_key, old_value, new_value) VALUES (?, ?, ?, ?)`,
      args: [auditId, args.knob, String(oldValues[args.knob] ?? ''), stored],
    })

    return {
      output: JSON.stringify({
        tuned: true,
        knob: args.knob,
        new_value: parsed,
        rationale: args.rationale.trim(),
      }),
    }
  },
})
