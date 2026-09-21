import type { Client } from '@libsql/client'
import type { MemoryInput, SearchResult, TuningParams } from '../core/types.js'
import { computeTrustScore, updateEma } from '../core/trust.js'
import { DEFAULT_TUNING_PARAMS } from '../core/governance.js'
import { asNumber, asText } from './decode.js'
import { epochNow } from './epoch.js'

function asRowId(value: bigint | number | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  throw new Error('Missing inserted row id')
}

export async function ensureTaskType(db: Client, name: string): Promise<number> {
  await db.execute({ sql: `INSERT OR IGNORE INTO task_type (name) VALUES (?)`, args: [name] })
  const found = await db.execute({ sql: `SELECT id FROM task_type WHERE name = ?`, args: [name] })
  return asNumber(found.rows[0]?.['id'])
}

export async function getStatusId(db: Client, name: string): Promise<number> {
  const found = await db.execute({
    sql: `SELECT id FROM memory_status WHERE name = ?`,
    args: [name],
  })
  return asNumber(found.rows[0]?.['id'])
}

function parseTuningParams(rows: Array<{ key: string; value: string }>): TuningParams {
  const parsed: Record<string, string> = {}
  for (const row of rows) {
    parsed[row.key] = row.value
  }
  const decay = Number(parsed['decay_rate'] ?? DEFAULT_TUNING_PARAMS.decay_rate)
  const trustQ = Number(parsed['trust_quantile'] ?? DEFAULT_TUNING_PARAMS.trust_quantile)
  const doubtQ = Number(parsed['doubt_quantile'] ?? DEFAULT_TUNING_PARAMS.doubt_quantile)
  const minEv = Number(parsed['min_evidence'] ?? DEFAULT_TUNING_PARAMS.min_evidence)
  return {
    decay_rate: Number.isFinite(decay) ? decay : DEFAULT_TUNING_PARAMS.decay_rate,
    trust_quantile: Number.isFinite(trustQ) ? trustQ : DEFAULT_TUNING_PARAMS.trust_quantile,
    doubt_quantile: Number.isFinite(doubtQ) ? doubtQ : DEFAULT_TUNING_PARAMS.doubt_quantile,
    min_evidence: Number.isInteger(minEv) ? minEv : DEFAULT_TUNING_PARAMS.min_evidence,
    active_partition: parsed['active_partition'] ?? DEFAULT_TUNING_PARAMS.active_partition,
  }
}

export async function getTuningParams(db: Client): Promise<TuningParams> {
  const result = await db.execute({ sql: `SELECT key, value FROM tuning_param`, args: [] })
  const rows: Array<{ key: string; value: string }> = []
  for (const row of result.rows) {
    rows.push({ key: asText(row['key']), value: asText(row['value']) })
  }
  return parseTuningParams(rows)
}

export async function writeMemory(
  db: Client,
  input: MemoryInput,
  taskTypeName: string,
  statusName: string
): Promise<{ id: number; content: string; tags: string[]; task_type: string }> {
  const taskTypeId = await ensureTaskType(db, taskTypeName)
  const statusId = await getStatusId(db, statusName)
  const now = epochNow()

  const inserted = await db.execute({
    sql: `INSERT INTO memory (content, memory_status_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    args: [input.content, statusId, now, now],
  })
  const memoryId = asRowId(inserted.lastInsertRowid)

  const tagNames: string[] = []
  if (input.tags && input.tags.trim()) {
    for (const part of input.tags.split(',')) {
      const name = part.trim()
      if (name) tagNames.push(name)
    }
  }

  const writes: Array<{ sql: string; args: Array<string | number | null> }> = []
  for (const tagName of tagNames) {
    writes.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] })
  }
  if (writes.length > 0) {
    await db.batch(writes, 'write')
  }

  if (tagNames.length > 0) {
    const placeholders = tagNames.map(() => '?').join(', ')
    const tagRows = await db.execute({
      sql: `SELECT id, name FROM tag WHERE name IN (${placeholders})`,
      args: tagNames,
    })
    const links: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const row of tagRows.rows) {
      links.push({
        sql: `INSERT OR IGNORE INTO memory_tag_link (memory_id, tag_id) VALUES (?, ?)`,
        args: [memoryId, asNumber(row['id'])],
      })
    }
    links.push({
      sql: `INSERT OR IGNORE INTO memory_partition (memory_id, task_type_id) VALUES (?, ?)`,
      args: [memoryId, taskTypeId],
    })
    await db.batch(links, 'write')
  } else {
    await db.execute({
      sql: `INSERT OR IGNORE INTO memory_partition (memory_id, task_type_id) VALUES (?, ?)`,
      args: [memoryId, taskTypeId],
    })
  }

  return { id: memoryId, content: input.content, tags: tagNames, task_type: taskTypeName }
}

async function loadTags(db: Client, memoryIds: number[]): Promise<Map<number, string>> {
  const tagsByMemory = new Map<number, string[]>()
  if (memoryIds.length === 0) return new Map()
  const placeholders = memoryIds.map(() => '?').join(', ')
  const tagRows = await db.execute({
    sql: `SELECT mtl.memory_id AS memory_id, t.name AS name FROM tag t JOIN memory_tag_link mtl ON t.id = mtl.tag_id WHERE mtl.memory_id IN (${placeholders})`,
    args: memoryIds,
  })
  for (const row of tagRows.rows) {
    const memoryId = asNumber(row['memory_id'])
    const name = asText(row['name'])
    const existing = tagsByMemory.get(memoryId) ?? []
    existing.push(name)
    tagsByMemory.set(memoryId, existing)
  }
  const joined = new Map<number, string>()
  for (const [memoryId, names] of tagsByMemory) {
    joined.set(memoryId, names.join(','))
  }
  return joined
}

export async function getMemory(db: Client, id: number): Promise<SearchResult | null> {
  const result = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at, ms.name AS status_name FROM memory m JOIN memory_status ms ON m.memory_status_id = ms.id WHERE m.id = ? AND m.deleted_at IS NULL`,
    args: [id],
  })
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  if (!row) return null

  const tags = await loadTags(db, [id])
  const trust = computeTrustScore(asNumber(row['ema_success']), asNumber(row['ema_failure']))
  return {
    id: asNumber(row['id']),
    content: asText(row['content']),
    tags: tags.get(id) ?? '',
    task_type: asText(row['status_name']),
    trust_label: trust.label,
    trust_score: Math.round(trust.score * 100) / 100,
    evidence_count: asNumber(row['evidence_count']),
    created_at: asText(row['created_at']),
    rank: 0,
  }
}

export async function searchMemories(
  db: Client,
  query: string,
  limit: number,
  taskTypeName?: string,
  sessionId?: string
): Promise<SearchResult[]> {
  const bounded = Math.max(1, Math.min(limit, 50))
  let taskTypeId: number | undefined
  if (taskTypeName) {
    taskTypeId = await ensureTaskType(db, taskTypeName)
  }

  const rows = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at, bm25(memory_fts) AS rank FROM memory_fts JOIN memory m ON m.id = memory_fts.rowid JOIN memory_status ms ON m.memory_status_id = ms.id WHERE memory_fts MATCH ? AND m.deleted_at IS NULL AND ms.name NOT IN ('invalidated', 'merged') ${taskTypeId !== undefined ? `AND m.id IN (SELECT memory_id FROM memory_partition WHERE task_type_id = ?)` : ``} ORDER BY rank LIMIT ?`,
    args: taskTypeId !== undefined ? [query, taskTypeId, bounded * 3] : [query, bounded * 3],
  })

  type RawMemory = {
    id: number
    content: string
    evidence_count: number
    ema_success: number
    ema_failure: number
    created_at: string
    rank: number
  }
  const found: RawMemory[] = []
  for (const row of rows.rows) {
    found.push({
      id: asNumber(row['id']),
      content: asText(row['content']),
      evidence_count: asNumber(row['evidence_count']),
      ema_success: asNumber(row['ema_success']),
      ema_failure: asNumber(row['ema_failure']),
      created_at: asText(row['created_at']),
      rank: asNumber(row['rank']),
    })
  }

  const sliced = found.slice(0, bounded)
  const ids: number[] = []
  for (const item of sliced) {
    ids.push(item.id)
  }
  const tags = await loadTags(db, ids)

  if (sessionId && ids.length > 0) {
    const now = epochNow()
    const retrievals: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const id of ids) {
      retrievals.push({
        sql: `INSERT INTO session_memory (session_id, memory_id, retrieved_at) VALUES (?, ?, ?)`,
        args: [sessionId, id, now],
      })
    }
    await db.batch(retrievals, 'write')
  }

  const results: SearchResult[] = []
  for (const item of sliced) {
    const trust = computeTrustScore(item.ema_success, item.ema_failure)
    results.push({
      id: item.id,
      content: item.content,
      tags: tags.get(item.id) ?? '',
      task_type: taskTypeName ?? 'general',
      trust_label: trust.label,
      trust_score: Math.round(trust.score * 100) / 100,
      evidence_count: item.evidence_count,
      created_at: item.created_at,
      rank: item.rank,
    })
  }
  return results
}

export async function updateTrustScore(
  db: Client,
  memoryId: number,
  outcome: boolean,
  taskTypeId: number
): Promise<void> {
  const params = await getTuningParams(db)
  const memResult = await db.execute({
    sql: `SELECT ema_success, ema_failure, evidence_count FROM memory WHERE id = ?`,
    args: [memoryId],
  })
  if (memResult.rows.length === 0) return
  const mem = memResult.rows[0]
  if (!mem) return
  const next = updateEma(
    asNumber(mem['ema_success']),
    asNumber(mem['ema_failure']),
    outcome,
    params.decay_rate
  )
  const nextCount = asNumber(mem['evidence_count']) + 1
  const now = epochNow()

  const partResult = await db.execute({
    sql: `SELECT id, ema_success, ema_failure, evidence_count FROM memory_partition WHERE memory_id = ? AND task_type_id = ?`,
    args: [memoryId, taskTypeId],
  })

  if (partResult.rows.length > 0) {
    const part = partResult.rows[0]
    if (!part) return
    const nextPart = updateEma(
      asNumber(part['ema_success']),
      asNumber(part['ema_failure']),
      outcome,
      params.decay_rate
    )
    await db.batch(
      [
        {
          sql: `UPDATE memory SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`,
          args: [next.ema_success, next.ema_failure, nextCount, now, memoryId],
        },
        {
          sql: `UPDATE memory_partition SET ema_success = ?, ema_failure = ?, evidence_count = ? WHERE id = ?`,
          args: [
            nextPart.ema_success,
            nextPart.ema_failure,
            asNumber(part['evidence_count']) + 1,
            asNumber(part['id']),
          ],
        },
      ],
      'write'
    )
    return
  }

  await db.batch(
    [
      {
        sql: `UPDATE memory SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`,
        args: [next.ema_success, next.ema_failure, nextCount, now, memoryId],
      },
      {
        sql: `INSERT INTO memory_partition (memory_id, task_type_id, ema_success, ema_failure, evidence_count) VALUES (?, ?, ?, ?, ?)`,
        args: [memoryId, taskTypeId, next.ema_success, next.ema_failure, 1],
      },
    ],
    'write'
  )
}
