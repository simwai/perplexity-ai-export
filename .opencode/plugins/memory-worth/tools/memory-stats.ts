import { tool } from '@opencode-ai/plugin'
import { asNumber } from '../db/decode.js'
import { getTuningParams } from '../db/queries.js'
import { getToolDb } from './get-db.js'

export const memoryStatsTool = tool({
  description:
    'Inspect memory health: calibration, discrimination, distribution, and named flags. Use this before tuning.',
  args: {},
  async execute(_args, context) {
    const db = await getToolDb(context.directory)
    const params = await getTuningParams(db)

    const totalMemoriesResult = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM memory WHERE deleted_at IS NULL`,
      args: [],
    })
    const totalOutcomesResult = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM outcome`,
      args: [],
    })
    const totalMemories = asNumber(totalMemoriesResult.rows[0]?.['cnt'])
    const totalOutcomes = asNumber(totalOutcomesResult.rows[0]?.['cnt'])

    if (totalMemories === 0 || totalOutcomes === 0) {
      return {
        output: JSON.stringify({
          status: 'insufficient_data',
          message: 'Not enough data to generate meaningful stats.',
          memories: totalMemories,
          outcomes: totalOutcomes,
        }),
      }
    }

    const scoredRows = await db.execute({
      sql: `SELECT m.ema_success AS ema_success, m.ema_failure AS ema_failure, o.outcome AS outcome FROM memory m JOIN outcome o ON o.memory_id = m.id WHERE m.deleted_at IS NULL AND m.evidence_count >= ?`,
      args: [params.min_evidence],
    })

    const scored: Array<{ predicted: number; actual: number }> = []
    for (const row of scoredRows.rows) {
      const success = asNumber(row['ema_success'])
      const failure = asNumber(row['ema_failure'])
      const total = success + failure
      scored.push({
        predicted: total === 0 ? 0.5 : success / total,
        actual: asNumber(row['outcome']),
      })
    }

    const deciles: Array<{
      bin: string
      count: number
      avg_predicted: number
      avg_actual: number
    }> = []
    for (let i = 0; i < 10; i++) {
      const lo = i / 10
      const hi = (i + 1) / 10
      let count = 0
      let predictedSum = 0
      let actualSum = 0
      for (const item of scored) {
        if (item.predicted >= lo && item.predicted < hi) {
          count += 1
          predictedSum += item.predicted
          actualSum += item.actual
        }
      }
      deciles.push({
        bin: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
        count,
        avg_predicted: count > 0 ? predictedSum / count : 0,
        avg_actual: count > 0 ? actualSum / count : 0,
      })
    }

    let calibrationSum = 0
    for (const bin of deciles) {
      calibrationSum += Math.abs(bin.avg_predicted - bin.avg_actual)
    }
    const calibrationError = calibrationSum / deciles.length

    let highCount = 0
    let highSum = 0
    let lowCount = 0
    let lowSum = 0
    for (const item of scored) {
      if (item.predicted >= 0.7) {
        highCount += 1
        highSum += item.actual
      }
      if (item.predicted <= 0.3) {
        lowCount += 1
        lowSum += item.actual
      }
    }
    const highRate = highCount > 0 ? highSum / highCount : 0
    const lowRate = lowCount > 0 ? lowSum / lowCount : 0

    const sorted: number[] = []
    for (const item of scored) {
      sorted.push(item.predicted)
    }
    sorted.sort((a, b) => a - b)
    const pct = (p: number): number => sorted[Math.floor(sorted.length * p)] ?? 0

    const flags: string[] = []
    if (calibrationError > 0.15) flags.push('calibration is degrading')
    if (highRate - lowRate < 0.05 && scored.length > 20)
      flags.push("I can't tell good memories from bad ones")
    if (highRate < lowRate + 0.05 && highCount > 10 && lowCount > 10)
      flags.push('my scores are worse than guessing')

    let status = 'nominal'
    if (flags.length > 0) {
      let severe = false
      for (const flag of flags) {
        if (flag.includes('worse than guessing') || flag.includes("can't tell")) severe = true
      }
      status = severe ? 'degraded' : 'watch'
    }

    return {
      output: JSON.stringify({
        status,
        memories: totalMemories,
        outcomes: totalOutcomes,
        calibration: { error: Math.round(calibrationError * 1000) / 1000, deciles },
        discrimination: {
          high_trust_rate: Math.round(highRate * 1000) / 1000,
          low_trust_rate: Math.round(lowRate * 1000) / 1000,
          delta: Math.round((highRate - lowRate) * 1000) / 1000,
        },
        distribution: {
          p5: Math.round(pct(0.05) * 100) / 100,
          p25: Math.round(pct(0.25) * 100) / 100,
          p50: Math.round(pct(0.5) * 100) / 100,
          p75: Math.round(pct(0.75) * 100) / 100,
          p95: Math.round(pct(0.95) * 100) / 100,
        },
        flags,
        recommendation: flags.length > 0 ? flags[0] : 'no action needed',
      }),
    }
  },
})
