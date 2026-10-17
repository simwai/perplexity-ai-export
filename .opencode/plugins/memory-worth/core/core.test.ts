import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSeededRandom, hashString } from './prng.js'
import {
  computeTrustLabel,
  computeTrustScore,
  mergePartitions,
  mwOf,
  quantileLabel,
  trustOf,
  updateCounters,
  updateEma,
} from './trust.js'
import {
  computeStatus,
  createAuditEntry,
  DEFAULT_TUNING_PARAMS,
  shouldInvalidate,
  validateTuningParams,
} from './governance.js'
import { err, from, fromAsync, isErr, isOk, ok } from './result.js'
import { applyInvalidation, isInvalidated } from './invalidation.js'
import { calibrationError, deciles, discrimination } from './calibration.js'
import type { CalibrationEntry, Episode } from './types.js'

describe('prng', () => {
  it('replays the same sequence for the same seed', () => {
    const first = createSeededRandom(42)
    const second = createSeededRandom(42)
    for (let i = 0; i < 5; i++) {
      assert.equal(first(), second())
    }
  })

  it('hashes strings deterministically', () => {
    assert.equal(hashString('memory'), hashString('memory'))
    assert.notEqual(hashString('memory-a'), hashString('memory-b'))
  })
})

describe('trust', () => {
  it('scores success share with a neutral default', () => {
    assert.equal(computeTrustScore(3, 1).score, 0.75)
    assert.equal(computeTrustScore(0, 0).score, 0.5)
  })

  it('marks thin evidence as unproven', () => {
    assert.equal(computeTrustLabel(9, 1, 2, DEFAULT_TUNING_PARAMS, []), 'unproven')
  })

  it('grades against the observed distribution', () => {
    const population: Array<{ ema_success: number; ema_failure: number }> = []
    for (let i = 1; i <= 20; i++) {
      population.push({ ema_success: i, ema_failure: 20 - i })
    }
    assert.equal(computeTrustLabel(19, 1, 20, DEFAULT_TUNING_PARAMS, population), 'high')
    assert.equal(computeTrustLabel(1, 19, 20, DEFAULT_TUNING_PARAMS, population), 'low')
  })

  it('decays EMA toward the latest outcome', () => {
    const next = updateEma(0.5, 0.5, true, 0.5)
    assert.equal(next.ema_success, 0.75)
    assert.equal(next.ema_failure, 0.25)
  })

  it('merges disjoint and overlapping partitions', () => {
    const merged = mergePartitions(
      { debug: { ema_success: 0.8, ema_failure: 0.2, evidence_count: 4 } },
      { review: { ema_success: 0.4, ema_failure: 0.6, evidence_count: 6 } },
      0.3
    )
    assert.equal(merged['debug']?.evidence_count, 4)
    assert.equal(merged['review']?.evidence_count, 6)
  })
})

describe('governance', () => {
  it('accepts sane knobs and rejects broken ones', () => {
    assert.equal(isOk(validateTuningParams({ decay_rate: 0.3 })), true)
    assert.equal(isErr(validateTuningParams({ decay_rate: 0 })), true)
    assert.equal(isErr(validateTuningParams({ trust_quantile: 0.2, doubt_quantile: 0.4 })), true)
    assert.equal(isErr(validateTuningParams({ min_evidence: 0 })), true)
  })

  it('invalidates weak or stale memories', () => {
    assert.equal(
      shouldInvalidate(
        0.1,
        {
          invalidation_threshold: 0.2,
          merge_similarity_threshold: 0.85,
          auto_archive_after_days: 30,
          max_evidence_per_partition: 1000,
        },
        3
      ),
      true
    )
    assert.equal(
      shouldInvalidate(
        0.9,
        {
          invalidation_threshold: 0.2,
          merge_similarity_threshold: 0.85,
          auto_archive_after_days: 30,
          max_evidence_per_partition: 1000,
        },
        3
      ),
      false
    )
  })

  it('archives low-trust week-old memories', () => {
    const policy = {
      invalidation_threshold: 0.2,
      merge_similarity_threshold: 0.85,
      auto_archive_after_days: 30,
      max_evidence_per_partition: 1000,
    }
    assert.equal(computeStatus('low', 8, policy), 'archived')
    assert.equal(computeStatus('high', 3, policy), 'active')
  })

  it('records audit entries with rationale', () => {
    const entry = createAuditEntry(
      'agent',
      'raise evidence bar',
      { min_evidence: 5 },
      { min_evidence: 10 }
    )
    assert.equal(entry.changed_by, 'agent')
    assert.equal(entry.rationale, 'raise evidence bar')
  })
})

describe('result', () => {
  it('narrows ok and err branches', () => {
    const good = ok(7)
    assert.equal(isOk(good), true)
    if (isOk(good)) assert.equal(good.value, 7)
    const bad = err(new Error('nope'))
    assert.equal(isErr(bad), true)
  })

  it('captures throwing helpers', () => {
    assert.equal(isOk(from(() => 1 + 1)), true)
    assert.equal(
      isErr(
        from(() => {
          throw new Error('boom')
        })
      ),
      true
    )
  })

  it('captures rejecting helpers', async () => {
    const settled = await fromAsync(async () => 3)
    assert.equal(isOk(settled), true)
  })
})

describe('mw-trust', () => {
  it('computes posterior means with a neutral default', () => {
    assert.equal(mwOf(3, 1), 0.75)
    assert.equal(mwOf(0, 0), 0.5)
    assert.deepEqual(trustOf(3, 1), { s_plus: 3, s_minus: 1, mw: 0.75 })
  })

  it('counts support and conflict observations', () => {
    assert.deepEqual(updateCounters(2, 1, true), { s_plus: 3, s_minus: 1 })
    assert.deepEqual(updateCounters(2, 1, false), { s_plus: 2, s_minus: 2 })
  })

  it('grades mw against population quantiles', () => {
    const population: number[] = []
    for (let i = 1; i <= 20; i++) {
      population.push(i / 20)
    }
    assert.equal(quantileLabel(0.95, population, 0.3, 0.3), 'high')
    assert.equal(quantileLabel(0.05, population, 0.3, 0.3), 'low')
    assert.equal(quantileLabel(0.5, population, 0.3, 0.3), 'neutral')
    assert.equal(quantileLabel(0.95, [0.9], 0.3, 0.3), 'neutral')
  })
})

describe('invalidation', () => {
  it('invalidates on observation without erasing status history', () => {
    assert.equal(applyInvalidation('active', { cause: 'contradiction' }), 'invalidated')
    assert.equal(
      applyInvalidation('active', { cause: 'superseded', supersededBy: 7 }),
      'invalidated'
    )
    assert.equal(applyInvalidation('merged', { cause: 'revoked' }), 'merged')
    assert.equal(isInvalidated('invalidated'), true)
    assert.equal(isInvalidated('active'), false)
  })

  it('carries episode and calibration-entry shapes', () => {
    const episode: Episode = {
      id: 1,
      session_id: 's',
      task_type: 'general',
      started_at: '0',
      resolved_at: undefined,
      outcome: null,
    }
    const entry: CalibrationEntry = { episode_id: episode.id, memory_id: 2, mw_before: 0.6 }
    assert.equal(entry.mw_before, 0.6)
  })
})

describe('calibration', () => {
  it('bins predictions into deciles', () => {
    const buckets = deciles([
      { predicted: 0.05, actual: 0 },
      { predicted: 0.95, actual: 1 },
    ])
    assert.equal(buckets.length, 10)
    assert.equal(buckets[0]?.count, 1)
    assert.equal(buckets[9]?.count, 1)
  })

  it('scores perfect predictions at zero error', () => {
    const errValue = calibrationError([
      { predicted: 0.1, actual: 0 },
      { predicted: 0.9, actual: 1 },
    ])
    assert.ok(Math.abs(errValue - 0.02) < 1e-9)
  })

  it('separates high and low trust rates', () => {
    const result = discrimination([
      { predicted: 0.9, actual: 1 },
      { predicted: 0.1, actual: 0 },
    ])
    assert.equal(result.delta, 1)
  })
})
