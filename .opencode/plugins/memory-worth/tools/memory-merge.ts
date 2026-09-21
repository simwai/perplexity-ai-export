import { tool } from '@opencode-ai/plugin'
import { asNumber, asText } from '../db/decode.js'
import { epochNow } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memoryMergeTool = tool({
  description:
    'Merge two memories into one. Combines evidence counts and inherits the stronger trust signal.',
  args: {
    source_id: tool.schema
      .number()
      .describe('ID of the memory to merge FROM (will be marked merged)'),
    target_id: tool.schema.number().describe('ID of the memory to merge INTO (will be kept)'),
  },
  async execute(args, context) {
    if (args.source_id === args.target_id) return { output: 'Error: source and target must differ' }
    const db = await getToolDb(context.directory)

    const source = await db.execute({
      sql: `SELECT content, ema_success, ema_failure, evidence_count FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.source_id],
    })
    const target = await db.execute({
      sql: `SELECT content, ema_success, ema_failure, evidence_count FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.target_id],
    })
    if (source.rows.length === 0)
      return { output: `Error: Source memory ${args.source_id} not found` }
    if (target.rows.length === 0)
      return { output: `Error: Target memory ${args.target_id} not found` }
    const s = source.rows[0]
    const t = target.rows[0]
    if (!s || !t) return { output: 'Error: memory rows missing' }

    const sourceContent = asText(s['content'])
    const targetContent = asText(t['content'])
    const sourceWeight = asNumber(s['evidence_count']) || 1
    const targetWeight = asNumber(t['evidence_count']) || 1
    const totalWeight = sourceWeight + targetWeight
    const mergedSuccess =
      (asNumber(s['ema_success']) * sourceWeight + asNumber(t['ema_success']) * targetWeight) /
      totalWeight
    const mergedFailure =
      (asNumber(s['ema_failure']) * sourceWeight + asNumber(t['ema_failure']) * targetWeight) /
      totalWeight
    const mergedEvidence = asNumber(s['evidence_count']) + asNumber(t['evidence_count'])

    let mergedContent = targetContent
    if (sourceContent.length > targetContent.length && !targetContent.includes(sourceContent)) {
      mergedContent = `${targetContent}\n\n---\n\n${sourceContent}`
    }

    const now = epochNow()
    await db.batch(
      [
        {
          sql: `UPDATE memory SET content = ?, ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`,
          args: [mergedContent, mergedSuccess, mergedFailure, mergedEvidence, now, args.target_id],
        },
        {
          sql: `UPDATE memory SET memory_status_id = (SELECT id FROM memory_status WHERE name = 'merged'), deleted_at = ? WHERE id = ?`,
          args: [now, args.source_id],
        },
      ],
      'write'
    )
    return {
      output: JSON.stringify({
        merged: true,
        target_id: args.target_id,
        source_id: args.source_id,
      }),
    }
  },
})
