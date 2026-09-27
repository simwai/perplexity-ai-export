import type { Client } from '@libsql/client'
import type { MemoryInput, SearchResult, TrustLabel, TuningParams } from '../core/types.js'
import { computeTrustScore, mwOf, quantileLabel, updateEma } from '../core/trust.js'
import { DEFAULT_TUNING_PARAMS } from '../core/governance.js'
import { asNumber, asText } from './decode.js'
import { epochInt, epochNow } from './epoch.js'

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
  const result = await db.execute({
    sql: `SELECT key, value FROM tuning_param_legacy_v1`,
    args: [],
  })
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
    sql: `INSERT INTO memory_legacy_v1 (content, memory_status_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
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
        sql: `INSERT OR IGNORE INTO memory_tag_link_legacy_v1 (memory_id, tag_id) VALUES (?, ?)`,
        args: [memoryId, asNumber(row['id'])],
      })
    }
    links.push({
      sql: `INSERT OR IGNORE INTO memory_partition_legacy_v1 (memory_id, task_type_id) VALUES (?, ?)`,
      args: [memoryId, taskTypeId],
    })
    await db.batch(links, 'write')
  } else {
    await db.execute({
      sql: `INSERT OR IGNORE INTO memory_partition_legacy_v1 (memory_id, task_type_id) VALUES (?, ?)`,
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
    sql: `SELECT mtl.memory_id AS memory_id, t.name AS name FROM tag t JOIN memory_tag_link_legacy_v1 mtl ON t.id = mtl.tag_id WHERE mtl.memory_id IN (${placeholders})`,
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

async function loadTaskTypes(db: Client, memoryIds: number[]): Promise<Map<number, string>> {
  const typesByMemory = new Map<number, string>()
  if (memoryIds.length === 0) return typesByMemory
  const placeholders = memoryIds.map(() => '?').join(', ')
  const typeRows = await db.execute({
    sql: `SELECT mp.memory_id AS memory_id, tt.name AS name FROM task_type tt JOIN memory_partition_legacy_v1 mp ON tt.id = mp.task_type_id WHERE mp.memory_id IN (${placeholders}) ORDER BY mp.id`,
    args: memoryIds,
  })
  for (const row of typeRows.rows) {
    const memoryId = asNumber(row['memory_id'])
    if (!typesByMemory.has(memoryId)) {
      typesByMemory.set(memoryId, asText(row['name']))
    }
  }
  return typesByMemory
}

export async function getMemory(db: Client, id: number): Promise<SearchResult | null> {
  const result = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at FROM memory_legacy_v1 m WHERE m.id = ? AND m.deleted_at IS NULL`,
    args: [id],
  })
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  if (!row) return null

  const tags = await loadTags(db, [id])
  const taskTypes = await loadTaskTypes(db, [id])
  const trust = computeTrustScore(asNumber(row['ema_success']), asNumber(row['ema_failure']))
  return {
    id: asNumber(row['id']),
    content: asText(row['content']),
    tags: tags.get(id) ?? '',
    task_type: taskTypes.get(id) ?? 'general',
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
    sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at, bm25(memory_fts) AS rank FROM memory_fts JOIN memory_legacy_v1 m ON m.id = memory_fts.rowid JOIN memory_status ms ON m.memory_status_id = ms.id WHERE memory_fts MATCH ? AND m.deleted_at IS NULL AND ms.name NOT IN ('invalidated', 'merged') ${taskTypeId !== undefined ? `AND m.id IN (SELECT memory_id FROM memory_partition_legacy_v1 WHERE task_type_id = ?)` : ``} ORDER BY rank LIMIT ?`,
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
  const taskTypes = await loadTaskTypes(db, ids)

  if (sessionId && ids.length > 0) {
    const now = epochNow()
    const retrievals: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const id of ids) {
      retrievals.push({
        sql: `INSERT INTO session_memory_legacy_v1 (session_id, memory_id, retrieved_at) VALUES (?, ?, ?)`,
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
      task_type: taskTypes.get(item.id) ?? 'general',
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
    sql: `SELECT ema_success, ema_failure, evidence_count FROM memory_legacy_v1 WHERE id = ?`,
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
    sql: `SELECT id, ema_success, ema_failure, evidence_count FROM memory_partition_legacy_v1 WHERE memory_id = ? AND task_type_id = ?`,
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
          sql: `UPDATE memory_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`,
          args: [next.ema_success, next.ema_failure, nextCount, now, memoryId],
        },
        {
          sql: `UPDATE memory_partition_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ? WHERE id = ?`,
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
        sql: `UPDATE memory_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`,
        args: [next.ema_success, next.ema_failure, nextCount, now, memoryId],
      },
      {
        sql: `INSERT INTO memory_partition_legacy_v1 (memory_id, task_type_id, ema_success, ema_failure, evidence_count) VALUES (?, ?, ?, ?, ?)`,
        args: [memoryId, taskTypeId, next.ema_success, next.ema_failure, 1],
      },
    ],
    'write'
  )
}

// ---------------------------------------------------------------------------
// Spec-shaped (v2) query API. Additive: v1 functions above stay intact until
// Stage 7 rewires the tools. Reason/mode arguments from the spec tool surface
// are interpreted by callers: the v2 schema stores status only, so
// invalidate/merge/delete semantics below are status transitions and the
// tool layer decides which transition a reason/mode maps to.
// ---------------------------------------------------------------------------

export interface SpecGroundInput {
  kind: string
  value: string
  fingerprint?: string
}

export interface SpecMemoryInput {
  content: string
  applies_when: string
  tags?: string[]
  grounds?: SpecGroundInput[]
  taskType?: string
  memoryType?: string
  tier?: string
  source?: string
  project?: string
  topic?: string
  confidence?: number
}

export interface SpecGround {
  kind: string
  value: string
}

export interface SpecMemory {
  id: number
  content: string
  applies_when: string
  confidence: number
  s_plus: number
  s_minus: number
  mw: number
  usage_count: number
  project: string
  topic: string | undefined
  task_type: string
  memory_type: string
  status: string
  tier: string
  source: string
  created_at: number
  updated_at: number
  tags: string[]
  grounds: SpecGround[]
}

export interface SpecSearchOptions {
  project?: string
  topic?: string
  tier?: string
  limit?: number
  sessionId?: string
  taskType?: string
}

export interface SpecSearchHit {
  id: number
  content: string
  mw: number
  usage_count: number
  task_type: string
}

export interface SpecStats {
  total: number
  by_status: Record<string, number>
  avg_mw: number
  episodes: number
  unresolved_episodes: number
}

type LookupTable =
  | 'task_type'
  | 'memory_type'
  | 'memory_status'
  | 'memory_tier'
  | 'memory_source'
  | 'ground_kind'
  | 'edge_kind'

async function lookupId(db: Client, table: LookupTable, name: string): Promise<number> {
  await db.execute({ sql: `INSERT OR IGNORE INTO ${table} (name) VALUES (?)`, args: [name] })
  const found = await db.execute({ sql: `SELECT id FROM ${table} WHERE name = ?`, args: [name] })
  return asNumber(found.rows[0]?.['id'])
}

function escapeLike(query: string): string {
  let out = ''
  for (const ch of query) {
    if (ch === '%' || ch === '_' || ch === '\\') out += '\\'
    out += ch
  }
  return out
}

export async function writeMemoryFull(db: Client, input: SpecMemoryInput): Promise<{ id: number }> {
  const content = input.content.trim()
  const appliesWhen = input.applies_when.trim()
  if (!content) throw new Error('content is required')
  if (!appliesWhen) throw new Error('applies_when is required')
  const now = epochInt()
  const taskTypeId = await lookupId(db, 'task_type', input.taskType ?? 'general')
  const memoryTypeId = await lookupId(db, 'memory_type', input.memoryType ?? 'note')
  const statusId = await lookupId(db, 'memory_status', 'active')
  const tierId = await lookupId(db, 'memory_tier', input.tier ?? 'L1')
  const sourceId = await lookupId(db, 'memory_source', input.source ?? 'session')

  const inserted = await db.execute({
    sql: `INSERT INTO memory (content, applies_when, confidence, project, topic, task_type_id, memory_type_id, status_id, tier_id, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      content,
      appliesWhen,
      input.confidence ?? 50.0,
      input.project ?? 'default',
      input.topic ?? null,
      taskTypeId,
      memoryTypeId,
      statusId,
      tierId,
      sourceId,
      now,
      now,
    ],
  })
  const memoryId = asRowId(inserted.lastInsertRowid)

  const tagNames: string[] = []
  for (const raw of input.tags ?? []) {
    const name = raw.trim()
    if (name) tagNames.push(name)
  }
  if (tagNames.length > 0) {
    const inserts: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const tagName of tagNames) {
      inserts.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] })
    }
    await db.batch(inserts, 'write')
    const placeholders = tagNames.map(() => '?').join(', ')
    const tagRows = await db.execute({
      sql: `SELECT id FROM tag WHERE name IN (${placeholders})`,
      args: tagNames,
    })
    const links: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const row of tagRows.rows) {
      links.push({
        sql: `INSERT OR IGNORE INTO memory_tag (memory_id, tag_id) VALUES (?, ?)`,
        args: [memoryId, asNumber(row['id'])],
      })
    }
    if (links.length > 0) {
      await db.batch(links, 'write')
    }
  }

  const grounds: Array<{ sql: string; args: Array<string | number | null> }> = []
  for (const ground of input.grounds ?? []) {
    const kindId = await lookupId(db, 'ground_kind', ground.kind)
    grounds.push({
      sql: `INSERT OR IGNORE INTO ground (memory_id, ground_kind_id, value, fingerprint, verified_at) VALUES (?, ?, ?, ?, ?)`,
      args: [memoryId, kindId, ground.value, ground.fingerprint ?? null, now],
    })
  }
  if (grounds.length > 0) {
    await db.batch(grounds, 'write')
  }
  return { id: memoryId }
}

async function loadSpecTags(db: Client, memoryId: number): Promise<string[]> {
  const rows = await db.execute({
    sql: `SELECT t.name AS name FROM tag t JOIN memory_tag mt ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name`,
    args: [memoryId],
  })
  const tags: string[] = []
  for (const row of rows.rows) {
    tags.push(asText(row['name']))
  }
  return tags
}

async function loadSpecGrounds(db: Client, memoryId: number): Promise<SpecGround[]> {
  const rows = await db.execute({
    sql: `SELECT gk.name AS kind, g.value AS value FROM ground g JOIN ground_kind gk ON g.ground_kind_id = gk.id WHERE g.memory_id = ? ORDER BY g.id`,
    args: [memoryId],
  })
  const grounds: SpecGround[] = []
  for (const row of rows.rows) {
    grounds.push({ kind: asText(row['kind']), value: asText(row['value']) })
  }
  return grounds
}

export async function getMemoryFull(db: Client, id: number): Promise<SpecMemory | null> {
  const result = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.applies_when AS applies_when, m.confidence AS confidence, m.s_plus AS s_plus, m.s_minus AS s_minus, m.mw AS mw, m.usage_count AS usage_count, m.project AS project, m.topic AS topic, tt.name AS task_type, mt.name AS memory_type, ms.name AS status, mtr.name AS tier, msrc.name AS source, m.created_at AS created_at, m.updated_at AS updated_at FROM memory m JOIN task_type tt ON m.task_type_id = tt.id JOIN memory_type mt ON m.memory_type_id = mt.id JOIN memory_status ms ON m.status_id = ms.id JOIN memory_tier mtr ON m.tier_id = mtr.id JOIN memory_source msrc ON m.source_id = msrc.id WHERE m.id = ?`,
    args: [id],
  })
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  if (!row) return null
  const memoryId = asNumber(row['id'])
  const tags = await loadSpecTags(db, memoryId)
  const grounds = await loadSpecGrounds(db, memoryId)
  const topicRaw = row['topic']
  return {
    id: memoryId,
    content: asText(row['content']),
    applies_when: asText(row['applies_when']),
    confidence: asNumber(row['confidence']),
    s_plus: asNumber(row['s_plus']),
    s_minus: asNumber(row['s_minus']),
    mw: asNumber(row['mw']),
    usage_count: asNumber(row['usage_count']),
    project: asText(row['project']),
    topic: topicRaw === null || topicRaw === undefined ? undefined : asText(topicRaw),
    task_type: asText(row['task_type']),
    memory_type: asText(row['memory_type']),
    status: asText(row['status']),
    tier: asText(row['tier']),
    source: asText(row['source']),
    created_at: asNumber(row['created_at']),
    updated_at: asNumber(row['updated_at']),
    tags,
    grounds,
  }
}

export async function ensureEpisode(
  db: Client,
  sessionId: string,
  taskTypeName: string
): Promise<number> {
  const open = await db.execute({
    sql: `SELECT id FROM episode WHERE session_id = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1`,
    args: [sessionId],
  })
  if (open.rows.length > 0) {
    return asNumber(open.rows[0]?.['id'])
  }
  const taskTypeId = await lookupId(db, 'task_type', taskTypeName)
  const inserted = await db.execute({
    sql: `INSERT INTO episode (session_id, task_type_id, started_at) VALUES (?, ?, ?)`,
    args: [sessionId, taskTypeId, epochInt()],
  })
  return asRowId(inserted.lastInsertRowid)
}

export async function resolveEpisode(
  db: Client,
  sessionId: string,
  outcome: boolean
): Promise<number> {
  const result = await db.execute({
    sql: `UPDATE episode SET resolved_at = ?, outcome = ? WHERE session_id = ? AND resolved_at IS NULL`,
    args: [epochInt(), outcome ? 1 : 0, sessionId],
  })
  return result.rowsAffected
}

export async function searchMemoriesFull(
  db: Client,
  query: string,
  opts: SpecSearchOptions = {}
): Promise<SpecSearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
  const conditions = [
    `ms.name = 'active'`,
    `(m.content LIKE ? ESCAPE '\\' OR m.applies_when LIKE ? ESCAPE '\\')`,
  ]
  const args: Array<string | number> = [`%${escapeLike(trimmed)}%`, `%${escapeLike(trimmed)}%`]
  if (opts.project !== undefined) {
    conditions.push(`m.project = ?`)
    args.push(opts.project)
  }
  if (opts.topic !== undefined) {
    conditions.push(`m.topic = ?`)
    args.push(opts.topic)
  }
  if (opts.tier !== undefined) {
    conditions.push(`m.tier_id = (SELECT id FROM memory_tier WHERE name = ?)`)
    args.push(opts.tier)
  }
  args.push(limit)
  const rows = await db.execute({
    sql: `SELECT m.id AS id, m.content AS content, m.mw AS mw, m.usage_count AS usage_count, tt.name AS task_type FROM memory m JOIN memory_status ms ON m.status_id = ms.id JOIN task_type tt ON m.task_type_id = tt.id WHERE ${conditions.join(' AND ')} ORDER BY m.mw DESC, m.usage_count DESC LIMIT ?`,
    args,
  })
  const hits: SpecSearchHit[] = []
  for (const row of rows.rows) {
    hits.push({
      id: asNumber(row['id']),
      content: asText(row['content']),
      mw: asNumber(row['mw']),
      usage_count: asNumber(row['usage_count']),
      task_type: asText(row['task_type']),
    })
  }
  if (opts.sessionId !== undefined && hits.length > 0) {
    const episodeId = await ensureEpisode(db, opts.sessionId, opts.taskType ?? 'general')
    const entries: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const hit of hits) {
      entries.push({
        sql: `INSERT OR IGNORE INTO calibration_entry (episode_id, memory_id, mw_before, created_at) VALUES (?, ?, ?, ?)`,
        args: [episodeId, hit.id, hit.mw, epochInt()],
      })
    }
    await db.batch(entries, 'write')
    const usage: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const hit of hits) {
      usage.push({
        sql: `UPDATE memory SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`,
        args: [epochInt(), hit.id],
      })
    }
    await db.batch(usage, 'write')
  }
  return hits
}

export async function applyOutcome(db: Client, memoryId: number, outcome: boolean): Promise<void> {
  const found = await db.execute({
    sql: `SELECT s_plus, s_minus FROM memory WHERE id = ?`,
    args: [memoryId],
  })
  if (found.rows.length === 0) return
  const row = found.rows[0]
  if (!row) return
  const sPlus = asNumber(row['s_plus']) + (outcome ? 1 : 0)
  const sMinus = asNumber(row['s_minus']) + (outcome ? 0 : 1)
  await db.execute({
    sql: `UPDATE memory SET s_plus = ?, s_minus = ?, mw = ?, updated_at = ? WHERE id = ?`,
    args: [sPlus, sMinus, mwOf(sPlus, sMinus), epochInt(), memoryId],
  })
}

export async function invalidateMemoryFull(db: Client, id: number): Promise<boolean> {
  const statusId = await lookupId(db, 'memory_status', 'invalidated')
  const result = await db.execute({
    sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
    args: [statusId, epochInt(), id],
  })
  return result.rowsAffected > 0
}

export async function mergeMemoriesFull(
  db: Client,
  targetId: number,
  sourceIds: number[],
  mergedContent: string
): Promise<{ kept: number; removed: number[] }> {
  const target = await getMemoryFull(db, targetId)
  if (!target) throw new Error(`target memory ${targetId} not found`)
  const archivedId = await lookupId(db, 'memory_status', 'archived')
  let sPlus = target.s_plus
  let sMinus = target.s_minus
  const removed: number[] = []
  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue
    const source = await getMemoryFull(db, sourceId)
    if (!source) continue
    sPlus += source.s_plus
    sMinus += source.s_minus
    removed.push(sourceId)
  }
  const now = epochInt()
  const writes: Array<{ sql: string; args: Array<string | number | null> }> = [
    {
      sql: `UPDATE memory SET content = ?, s_plus = ?, s_minus = ?, mw = ?, updated_at = ? WHERE id = ?`,
      args: [mergedContent, sPlus, sMinus, mwOf(sPlus, sMinus), now, targetId],
    },
  ]
  for (const sourceId of removed) {
    writes.push({
      sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
      args: [archivedId, now, sourceId],
    })
  }
  await db.batch(writes, 'write')
  return { kept: targetId, removed }
}

export async function deleteMemoryFull(db: Client, id: number): Promise<boolean> {
  const result = await db.execute({ sql: `DELETE FROM memory WHERE id = ?`, args: [id] })
  return result.rowsAffected > 0
}

export async function setStatusFull(
  db: Client,
  id: number,
  status: 'active' | 'archived'
): Promise<boolean> {
  const statusId = await lookupId(db, 'memory_status', status)
  const result = await db.execute({
    sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
    args: [statusId, epochInt(), id],
  })
  return result.rowsAffected > 0
}

export async function getStatsFull(db: Client): Promise<SpecStats> {
  const counts = await db.execute({
    sql: `SELECT ms.name AS status, COUNT(*) AS cnt FROM memory m JOIN memory_status ms ON m.status_id = ms.id GROUP BY ms.name`,
    args: [],
  })
  const byStatus: Record<string, number> = {}
  let total = 0
  for (const row of counts.rows) {
    const cnt = asNumber(row['cnt'])
    byStatus[asText(row['status'])] = cnt
    total += cnt
  }
  const avgRow = await db.execute({ sql: `SELECT AVG(mw) AS avg FROM memory`, args: [] })
  const avgRaw = avgRow.rows[0]?.['avg']
  const episodes = await db.execute({ sql: `SELECT COUNT(*) AS cnt FROM episode`, args: [] })
  const unresolved = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM episode WHERE resolved_at IS NULL`,
    args: [],
  })
  return {
    total,
    by_status: byStatus,
    avg_mw: typeof avgRaw === 'number' ? avgRaw : 0.5,
    episodes: asNumber(episodes.rows[0]?.['cnt']),
    unresolved_episodes: asNumber(unresolved.rows[0]?.['cnt']),
  }
}

export async function getParameter(db: Client, key: string, fallback: string): Promise<string> {
  const found = await db.execute({ sql: `SELECT value FROM parameter WHERE key = ?`, args: [key] })
  if (found.rows.length === 0) return fallback
  return asText(found.rows[0]?.['value'])
}

export async function setParameter(
  db: Client,
  key: string,
  value: string,
  rationale: string
): Promise<{ previous: string | undefined }> {
  const prior = await db.execute({ sql: `SELECT value FROM parameter WHERE key = ?`, args: [key] })
  const hasPrevious = prior.rows.length > 0
  const previous = hasPrevious ? asText(prior.rows[0]?.['value']) : undefined
  await db.batch(
    [
      {
        sql: `INSERT INTO parameter (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, value],
      },
      {
        sql: `INSERT INTO parameter_change (knob, old_value, new_value, rationale, changed_at) VALUES (?, ?, ?, ?, ?)`,
        args: [key, previous ?? null, value, rationale, epochInt()],
      },
    ],
    'write'
  )
  return { previous }
}

export async function labelMemory(
  db: Client,
  mw: number,
  sPlus: number,
  sMinus: number
): Promise<TrustLabel> {
  const minRaw = Number(await getParameter(db, 'min_evidence', '3'))
  const minEv = Number.isFinite(minRaw) ? minRaw : 3
  if (sPlus + sMinus < minEv) return 'unproven'
  const rows = await db.execute({
    sql: `SELECT m.mw AS mw FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active'`,
    args: [],
  })
  const population: number[] = []
  for (const row of rows.rows) {
    population.push(asNumber(row['mw']))
  }
  const trustRaw = Number(await getParameter(db, 'trust_q', '0.70'))
  const doubtRaw = Number(await getParameter(db, 'doubt_q', '0.30'))
  return quantileLabel(
    mw,
    population,
    Number.isFinite(trustRaw) ? trustRaw : 0.7,
    Number.isFinite(doubtRaw) ? doubtRaw : 0.3
  )
}

export async function findDuplicateFull(db: Client, content: string): Promise<number | null> {
  const found = await db.execute({
    sql: `SELECT m.id AS id FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE m.content = ? AND ms.name = 'active' LIMIT 1`,
    args: [content.trim()],
  })
  if (found.rows.length === 0) return null
  return asNumber(found.rows[0]?.['id'])
}

export async function sweepGrounds(db: Client, changedGrounds: string[]): Promise<number> {
  if (changedGrounds.length === 0) return 0

  const placeholders = changedGrounds.map(() => '?').join(', ')
  const groundRows = await db.execute({
    sql: `SELECT DISTINCT g.memory_id AS memory_id FROM ground g JOIN ground_kind gk ON g.ground_kind_id = gk.id WHERE g.value IN (${placeholders}) OR gk.name IN (${placeholders})`,
    args: [...changedGrounds, ...changedGrounds],
  })

  if (groundRows.rows.length === 0) return 0

  const memoryIds = groundRows.rows.map((row) => asNumber(row['memory_id']))
  if (memoryIds.length === 0) return 0

  const statusId = await lookupId(db, 'memory_status', 'invalidated')
  const now = epochInt()

  const writes: Array<{ sql: string; args: Array<string | number | null> }> = []
  for (const memoryId of memoryIds) {
    writes.push({
      sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
      args: [statusId, now, memoryId],
    })
  }
  await db.batch(writes, 'write')
  return memoryIds.length
}

export function previewParameterChange(
  key: string,
  proposedValue: string,
  currentParams: Record<string, string>
): PreviewResult {
  const current = currentParams[key]
  const num = Number(proposedValue)

  switch (key) {
    case 'trust_q': {
      if (!Number.isFinite(num) || num < 0 || num > 1)
        return { ok: false, error: 'trust_q must be between 0 and 1' }
      const doubt = Number(currentParams['doubt_q'] ?? DEFAULT_TUNING_PARAMS.doubt_quantile)
      if (num < doubt) return { ok: false, error: 'trust_q must be >= doubt_q' }
      return { ok: true, previous: current }
    }
    case 'doubt_q': {
      if (!Number.isFinite(num) || num < 0 || num > 1)
        return { ok: false, error: 'doubt_q must be between 0 and 1' }
      const trust = Number(currentParams['trust_q'] ?? DEFAULT_TUNING_PARAMS.trust_quantile)
      if (trust < num) return { ok: false, error: 'doubt_q must be <= trust_q' }
      return { ok: true, previous: current }
    }
    case 'min_evidence': {
      if (!Number.isInteger(num) || num < 1)
        return { ok: false, error: 'min_evidence must be a positive integer' }
      return { ok: true, previous: current }
    }
    case 'decay_rate': {
      if (!Number.isFinite(num) || num <= 0 || num > 1)
        return { ok: false, error: 'decay_rate must be between 0 and 1' }
      return { ok: true, previous: current }
    }
    case 'active_partition': {
      if (!proposedValue.trim()) return { ok: false, error: 'active_partition cannot be empty' }
      return { ok: true, previous: current }
    }
    case 'tune_interval': {
      if (!Number.isInteger(num) || num < 1)
        return { ok: false, error: 'tune_interval must be a positive integer' }
      return { ok: true, previous: current }
    }
    case 'window_size': {
      if (!Number.isInteger(num) || num < 1)
        return { ok: false, error: 'window_size must be a positive integer' }
      return { ok: true, previous: current }
    }
    default:
      return { ok: true, previous: current }
  }
}

export async function updateMemoryFull(
  db: Client,
  id: number,
  content: string,
  tags?: string[]
): Promise<boolean> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('content is required')
  const now = epochInt()
  const writes: Array<{ sql: string; args: Array<string | number | null> }> = [
    { sql: `UPDATE memory SET content = ?, updated_at = ? WHERE id = ?`, args: [trimmed, now, id] },
    { sql: `DELETE FROM memory_tag WHERE memory_id = ?`, args: [id] },
  ]
  const tagNames: string[] = []
  for (const raw of tags ?? []) {
    const name = raw.trim()
    if (name) tagNames.push(name)
  }
  for (const tagName of tagNames) {
    writes.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] })
  }
  await db.batch(writes, 'write')
  if (tagNames.length > 0) {
    const placeholders = tagNames.map(() => '?').join(', ')
    const tagRows = await db.execute({
      sql: `SELECT id FROM tag WHERE name IN (${placeholders})`,
      args: tagNames,
    })
    const links: Array<{ sql: string; args: Array<string | number | null> }> = []
    for (const row of tagRows.rows) {
      links.push({
        sql: `INSERT OR IGNORE INTO memory_tag (memory_id, tag_id) VALUES (?, ?)`,
        args: [id, asNumber(row['id'])],
      })
    }
    if (links.length > 0) {
      await db.batch(links, 'write')
    }
  }
  const check = await db.execute({ sql: `SELECT id FROM memory WHERE id = ?`, args: [id] })
  return check.rows.length > 0
}
