export interface ScoredPair {
  predicted: number
  actual: number
}

export interface DecileBin {
  bin: string
  count: number
  avg_predicted: number
  avg_actual: number
}

export function deciles(pairs: ReadonlyArray<ScoredPair>, bins = 10): DecileBin[] {
  const out: DecileBin[] = []
  for (let i = 0; i < bins; i++) {
    const lo = i / bins
    const hi = (i + 1) / bins
    let count = 0
    let predictedSum = 0
    let actualSum = 0
    for (const item of pairs) {
      const inBin =
        hi === 1
          ? item.predicted >= lo && item.predicted <= hi
          : item.predicted >= lo && item.predicted < hi
      if (inBin) {
        count += 1
        predictedSum += item.predicted
        actualSum += item.actual
      }
    }
    out.push({
      bin: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      count,
      avg_predicted: count > 0 ? predictedSum / count : 0,
      avg_actual: count > 0 ? actualSum / count : 0,
    })
  }
  return out
}

export function calibrationError(pairs: ReadonlyArray<ScoredPair>, bins = 10): number {
  const buckets = deciles(pairs, bins)
  if (buckets.length === 0) return 0
  let total = 0
  for (const bucket of buckets) {
    total += Math.abs(bucket.avg_predicted - bucket.avg_actual)
  }
  return total / buckets.length
}

export function discrimination(pairs: ReadonlyArray<ScoredPair>): {
  high_rate: number
  low_rate: number
  delta: number
} {
  let highCount = 0
  let highSum = 0
  let lowCount = 0
  let lowSum = 0
  for (const item of pairs) {
    if (item.predicted >= 0.7) {
      highCount += 1
      highSum += item.actual
    }
    if (item.predicted <= 0.3) {
      lowCount += 1
      lowSum += item.actual
    }
  }
  const high_rate = highCount > 0 ? highSum / highCount : 0
  const low_rate = lowCount > 0 ? lowSum / lowCount : 0
  return { high_rate, low_rate, delta: high_rate - low_rate }
}
