/**
 * Memory Worth Plugin for OpenCode
 *
 * Provides persistent, self-maintaining memory with a trust signal.
 * The agent decides what to store, update, merge, or delete.
 * Trust scores are associational (co-occurrence with success), partitioned by task type,
 * and quantile-based. The agent tunes the knobs itself via dedicated tools.
 *
 * Storage: SQLite via @libsql/client in local-file mode.
 * Location: .opencode/memory/memories.db
 */

import { type Plugin, tool } from '@opencode-ai/plugin'
import { createClient } from '@libsql/client'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Module-scope database instance (singleton per plugin load)
// ---------------------------------------------------------------------------

const MEMORY_DIR = '.opencode/memory'
const DB_PATH = `${MEMORY_DIR}/memories.db`

let db: ReturnType<typeof createClient> | null = null
let pluginDirectory: string | undefined

function setPluginDirectory(dir: string) {
  pluginDirectory = dir
}

async function getDb() {
  if (!db) {
    const baseDir = pluginDirectory || process.cwd()
    const absDir = path.resolve(baseDir, MEMORY_DIR)
    fs.mkdirSync(absDir, { recursive: true })
    db = createClient({ url: `file:${path.resolve(absDir, 'memories.db')}`, intMode: 'number' })
    await initSchema(db)
  }
  return db
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

async function initSchema(database: ReturnType<typeof createClient>) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT,
      task_type TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      ema_success REAL NOT NULL DEFAULT 0.5,
      ema_failure REAL NOT NULL DEFAULT 0.5,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      partition_data TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS tuning_params (
      key TEXT PRIMARY KEY,
      value REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS tuning_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      changed_by TEXT,
      rationale TEXT NOT NULL,
      old_values TEXT NOT NULL,
      new_values TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS outcome_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      outcome INTEGER NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS session_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      memory_id INTEGER NOT NULL,
      retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id
    )`,
    `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END`,
  ]

  for (const sql of statements) {
    await database.execute({ sql, args: [] })
  }

  const params = [
    { key: 'decay_rate', value: 0.3 },
    { key: 'trust_quantile', value: 0.3 },
    { key: 'doubt_quantile', value: 0.3 },
    { key: 'min_evidence', value: 5 },
    { key: 'active_partition', value: 'general' },
  ]

  for (const p of params) {
    await database.execute({
      sql: `INSERT OR IGNORE INTO tuning_params (key, value) VALUES (?, ?)`,
      args: [p.key, p.value],
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function detectOutcome(text: string): boolean | null {
  const hasSuccess = SUCCESS_SIGNALS.some((re) => re.test(text))
  const hasFailure = FAILURE_SIGNALS.some((re) => re.test(text))
  if (hasSuccess && !hasFailure) return true
  if (hasFailure && !hasSuccess) return false
  return null
}

async function getTuningParams(database: ReturnType<typeof createClient>) {
  const result = await database.execute({ sql: `SELECT key, value FROM tuning_params`, args: [] })
  const params: Record<string, number | string> = {}
  for (const row of result.rows) {
    const r = row as unknown as { key: string; value: number | string }
    params[r.key] = r.value
  }
  return params
}

async function getActivePartition(database: ReturnType<typeof createClient>): Promise<string> {
  const params = await getTuningParams(database)
  return String(params.active_partition ?? 'general')
}

async function computeTrustLabel(
  emaSuccess: number,
  emaFailure: number,
  evidenceCount: number,
  params: Record<string, number>
): Promise<string> {
  const minEvidence = params.min_evidence ?? 5
  if (evidenceCount < minEvidence) return 'unproven'

  const total = emaSuccess + emaFailure
  if (total === 0) return 'neutral'

  const score = emaSuccess / total
  const trustQuantile = params.trust_quantile ?? 0.3
  const doubtQuantile = params.doubt_quantile ?? 0.3

  const database = await getDb()
  const allScoresResult = await database.execute({
    sql: `SELECT ema_success, ema_failure, evidence_count FROM memories WHERE deleted_at IS NULL AND evidence_count >= ?`,
    args: [minEvidence],
  })

  if (allScoresResult.rows.length < 10) return 'neutral'

  const scores = allScoresResult.rows
    .map((r) => {
      const row = r as unknown as { ema_success: number; ema_failure: number }
      const t = row.ema_success + row.ema_failure
      return t === 0 ? 0.5 : row.ema_success / t
    })
    .sort((a, b) => a - b)

  const highIdx = Math.min(Math.floor(scores.length * (1 - trustQuantile)), scores.length - 1)
  const lowIdx = Math.min(Math.floor(scores.length * doubtQuantile), scores.length - 1)

  if (score >= scores[highIdx]) return 'high'
  if (score <= scores[lowIdx]) return 'low'
  return 'neutral'
}

async function updateTrustScore(
  memoryId: number,
  outcome: boolean,
  taskType: string,
  database: ReturnType<typeof createClient>
) {
  const params = await getTuningParams(database)
  const decay = Number(params.decay_rate ?? 0.3)

  const memResult = await database.execute({
    sql: `SELECT ema_success, ema_failure, evidence_count, partition_data FROM memories WHERE id = ?`,
    args: [memoryId],
  })

  if (memResult.rows.length === 0) return
  const mem = memResult.rows[0] as unknown as {
    ema_success: number
    ema_failure: number
    evidence_count: number
    partition_data: string
  }

  const partitionData = JSON.parse(mem.partition_data || '{}') as Record<
    string,
    { ema_success: number; ema_failure: number; evidence_count: number }
  >
  const bucket = partitionData[taskType] || {
    ema_success: 0.5,
    ema_failure: 0.5,
    evidence_count: 0,
  }

  const newEmaSuccess = mem.ema_success * (1 - decay) + (outcome ? 1 : 0) * decay
  const newEmaFailure = mem.ema_failure * (1 - decay) + (outcome ? 0 : 1) * decay

  const newBucketSuccess = bucket.ema_success * (1 - decay) + (outcome ? 1 : 0) * decay
  const newBucketFailure = bucket.ema_failure * (1 - decay) + (outcome ? 0 : 1) * decay
  partitionData[taskType] = {
    ema_success: newBucketSuccess,
    ema_failure: newBucketFailure,
    evidence_count: bucket.evidence_count + 1,
  }

  await database.execute({
    sql: `UPDATE memories SET ema_success = ?, ema_failure = ?, evidence_count = ?, partition_data = ? WHERE id = ?`,
    args: [
      newEmaSuccess,
      newEmaFailure,
      mem.evidence_count + 1,
      JSON.stringify(partitionData),
      memoryId,
    ],
  })
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const MemoryWorthPlugin: Plugin = async ({ client, $, directory, worktree }) => {
  setPluginDirectory(directory)
  return {
    event: async ({ event }: { event: any }) => {
      const database = await getDb()
      const eventType = event.type

      if (eventType === 'session.created') {
        const initParams = [
          { key: 'decay_rate', value: 0.3 },
          { key: 'trust_quantile', value: 0.3 },
          { key: 'doubt_quantile', value: 0.3 },
          { key: 'min_evidence', value: 5 },
          { key: 'active_partition', value: 'general' },
        ]
        for (const p of initParams) {
          await database.execute({
            sql: `INSERT OR IGNORE INTO tuning_params (key, value) VALUES (?, ?)`,
            args: [p.key, p.value],
          })
        }
        return
      }

      if (eventType === 'session.updated') {
        const info = event.properties?.info
        if (!info) return

        const messages = info.metadata?.messages as any[] | undefined
        if (!messages || messages.length === 0) return

        const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant')
        if (!lastAssistant?.content) return

        const text =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content)

        const outcome = detectOutcome(text)
        if (outcome === null) return

        const sessionId = event.properties.sessionID
        const taskType = await getActivePartition(database)

        await database.execute({
          sql: `INSERT INTO outcome_log (session_id, task_type, outcome) VALUES (?, ?, ?)`,
          args: [sessionId, taskType, outcome ? 1 : 0],
        })

        const retrievedResult = await database.execute({
          sql: `SELECT memory_id FROM session_memories WHERE session_id = ? ORDER BY retrieved_at DESC`,
          args: [sessionId],
        })

        for (const row of retrievedResult.rows) {
          const r = row as unknown as { memory_id: number }
          await updateTrustScore(r.memory_id, outcome, taskType, database)
        }

        await database.execute({
          sql: `DELETE FROM session_memories WHERE session_id = ?`,
          args: [sessionId],
        })
        return
      }

      if (eventType === 'session.deleted') {
        return
      }
    },

    tool: {
      memory_store: tool({
        description:
          'Store a piece of knowledge in persistent memory. Searches for near-duplicates before writing; if found, returns the existing memory instead of creating a duplicate.',
        args: {
          content: tool.schema.string().describe('The knowledge to store'),
          tags: tool.schema.string().optional().describe('Comma-separated tags'),
          task_type: tool.schema
            .string()
            .optional()
            .describe(
              'Task type bucket (e.g., debugging, refactoring, explaining). Default: general'
            ),
        },
        async execute(args) {
          const database = await getDb()
          const content = args.content.trim()
          if (!content) return { output: 'Error: content is required' }

          const tags = args.tags || ''
          const taskType = args.task_type || 'general'

          const similar = await database.execute({
            sql: `SELECT rowid AS id, content, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? AND rowid IN (SELECT id FROM memories WHERE deleted_at IS NULL) ORDER BY rank LIMIT 3`,
            args: [content],
          })

          if (similar.rows.length > 0 && (similar.rows[0] as any).rank < -2.0) {
            return {
              output: JSON.stringify({
                refused: true,
                reason: 'near-duplicate detected',
                existing: {
                  id: (similar.rows[0] as any).id,
                  content: (similar.rows[0] as any).content,
                  rank: (similar.rows[0] as any).rank,
                },
                suggestion: 'Use memory_update or memory_merge instead of creating a duplicate.',
              }),
            }
          }

          const result = await database.execute({
            sql: `INSERT INTO memories (content, tags, task_type) VALUES (?, ?, ?)`,
            args: [content, tags, taskType],
          })

          return {
            output: JSON.stringify({
              stored: true,
              id: Number(result.lastInsertRowid),
              content,
              tags,
              task_type: taskType,
            }),
          }
        },
      }),

      memory_search: tool({
        description:
          'Search memories by free-text query. Returns ranked results with trust labels (high/neutral/low/unproven).',
        args: {
          query: tool.schema.string().describe('Search query'),
          task_type: tool.schema.string().optional().describe('Filter by task type bucket'),
          limit: tool.schema.number().optional().describe('Max results (default 10)'),
        },
        async execute(args, context) {
          const database = await getDb()
          const query = args.query.trim()
          const limit = args.limit || 10
          const taskType = args.task_type
          const params = await getTuningParams(database)

          let sql = `
            SELECT m.id, m.content, m.tags, m.task_type, m.evidence_count,
                   m.ema_success, m.ema_failure, m.created_at,
                   bm25(memories_fts) AS rank
            FROM memories_fts
            JOIN memories m ON m.id = memories_fts.rowid
            WHERE memories_fts MATCH ?
            AND m.deleted_at IS NULL
          `
          const binds: any[] = [query]

          if (taskType) {
            sql += ' AND m.task_type = ?'
            binds.push(taskType)
          }

          sql += ' ORDER BY rank LIMIT ?'
          binds.push(limit)

          const rows = await database.execute({ sql, args: binds })

          const sessionId = (context as any).sessionID
          if (sessionId) {
            for (const row of rows.rows) {
              const r = row as unknown as { id: number }
              await database.execute({
                sql: `INSERT INTO session_memories (session_id, memory_id) VALUES (?, ?)`,
                args: [sessionId, r.id],
              })
            }
          }

          const results = []
          for (const row of rows.rows) {
            const r = row as unknown as {
              id: number
              content: string
              tags: string
              task_type: string
              evidence_count: number
              ema_success: number
              ema_failure: number
              created_at: string
              rank: number
            }
            const label = await computeTrustLabel(
              r.ema_success,
              r.ema_failure,
              r.evidence_count,
              params as Record<string, number>
            )
            const total = r.ema_success + r.ema_failure
            const score = total === 0 ? 0.5 : r.ema_success / total
            results.push({
              id: r.id,
              content: r.content,
              tags: r.tags,
              task_type: r.task_type,
              trust_label: label,
              trust_score: Math.round(score * 100) / 100,
              evidence_count: r.evidence_count,
              created_at: r.created_at,
              rank: r.rank,
            })
          }

          return { output: JSON.stringify(results) }
        },
      }),

      memory_update: tool({
        description: "Update a memory's content. Preserves accumulated trust scores.",
        args: {
          id: tool.schema.number().describe('Memory ID to update'),
          content: tool.schema.string().describe('New content'),
          tags: tool.schema.string().optional().describe('Updated tags (comma-separated)'),
        },
        async execute(args) {
          const database = await getDb()
          const existing = await database.execute({
            sql: `SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL`,
            args: [args.id],
          })

          if (existing.rows.length === 0) {
            return { output: `Error: Memory ${args.id} not found` }
          }

          await database.execute({
            sql: `UPDATE memories SET content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`,
            args: [args.content, args.tags || '', args.id],
          })

          return { output: JSON.stringify({ updated: true, id: args.id }) }
        },
      }),

      memory_merge: tool({
        description:
          'Merge two memories into one. Combines evidence counts and inherits the stronger trust signal.',
        args: {
          source_id: tool.schema
            .number()
            .describe('ID of the memory to merge FROM (will be deleted)'),
          target_id: tool.schema.number().describe('ID of the memory to merge INTO (will be kept)'),
        },
        async execute(args) {
          const database = await getDb()
          const source = await database.execute({
            sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
            args: [args.source_id],
          })
          const target = await database.execute({
            sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
            args: [args.target_id],
          })

          if (source.rows.length === 0)
            return { output: `Error: Source memory ${args.source_id} not found` }
          if (target.rows.length === 0)
            return { output: `Error: Target memory ${args.target_id} not found` }

          const s = source.rows[0] as any
          const t = target.rows[0] as any

          const sourceWeight = s.evidence_count || 1
          const targetWeight = t.evidence_count || 1
          const totalWeight = sourceWeight + targetWeight

          const mergedEmaSuccess =
            (s.ema_success * sourceWeight + t.ema_success * targetWeight) / totalWeight
          const mergedEmaFailure =
            (s.ema_failure * sourceWeight + t.ema_failure * targetWeight) / totalWeight

          const sourcePartitions = JSON.parse(s.partition_data || '{}')
          const targetPartitions = JSON.parse(t.partition_data || '{}')
          const mergedPartitions = { ...targetPartitions }

          for (const [taskType, data] of Object.entries(sourcePartitions)) {
            if (mergedPartitions[taskType]) {
              const sw = (data as any).evidence_count || 1
              const tw = (mergedPartitions[taskType] as any).evidence_count || 1
              const tw2 = sw + tw
              ;(mergedPartitions[taskType] as any).ema_success =
                ((data as any).ema_success * sw +
                  (mergedPartitions[taskType] as any).ema_success * tw) /
                tw2
              ;(mergedPartitions[taskType] as any).ema_failure =
                ((data as any).ema_failure * sw +
                  (mergedPartitions[taskType] as any).ema_failure * tw) /
                tw2
              ;(mergedPartitions[taskType] as any).evidence_count = tw2
            } else {
              mergedPartitions[taskType] = data
            }
          }

          let mergedContent = t.content
          if (s.content.length > t.content.length && !t.content.includes(s.content)) {
            mergedContent = `${t.content}\n\n---\n\n${s.content}`
          }

          await database.execute({
            sql: `UPDATE memories SET content = ?, partition_data = ?, ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = datetime('now') WHERE id = ?`,
            args: [
              mergedContent,
              JSON.stringify(mergedPartitions),
              mergedEmaSuccess,
              mergedEmaFailure,
              t.evidence_count + s.evidence_count,
              args.target_id,
            ],
          })

          await database.execute({
            sql: `UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`,
            args: [args.source_id],
          })

          return {
            output: JSON.stringify({
              merged: true,
              target_id: args.target_id,
              source_id: args.source_id,
            }),
          }
        },
      }),

      memory_delete: tool({
        description: 'Permanently delete a memory.',
        args: {
          id: tool.schema.number().describe('Memory ID to delete'),
        },
        async execute(args) {
          const database = await getDb()
          const existing = await database.execute({
            sql: `SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL`,
            args: [args.id],
          })

          if (existing.rows.length === 0) {
            return { output: `Error: Memory ${args.id} not found` }
          }

          await database.execute({
            sql: `UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`,
            args: [args.id],
          })

          return { output: JSON.stringify({ deleted: true, id: args.id }) }
        },
      }),

      memory_dashboard: tool({
        description:
          'Inspect memory health: calibration, discrimination, distribution, and named flags. Use this before tuning.',
        args: {},
        async execute() {
          const database = await getDb()
          const params = await getTuningParams(database)

          const totalMemoriesResult = await database.execute({
            sql: `SELECT COUNT(*) AS cnt FROM memories WHERE deleted_at IS NULL`,
            args: [],
          })
          const totalMemories = (totalMemoriesResult.rows[0] as any).cnt

          const totalOutcomesResult = await database.execute({
            sql: `SELECT COUNT(*) AS cnt FROM outcome_log`,
            args: [],
          })
          const totalOutcomes = (totalOutcomesResult.rows[0] as any).cnt

          if (totalMemories === 0 || totalOutcomes === 0) {
            return {
              output: JSON.stringify({
                status: 'insufficient_data',
                message:
                  'Not enough data to generate a meaningful dashboard. Store and retrieve memories across multiple tasks first.',
                memories: totalMemories,
                outcomes: totalOutcomes,
              }),
            }
          }

          const memoriesWithScores = await database.execute({
            sql: `SELECT m.ema_success, m.ema_failure, m.evidence_count, ol.outcome FROM memories m JOIN session_memories sm ON sm.memory_id = m.id JOIN outcome_log ol ON ol.session_id = sm.session_id WHERE m.deleted_at IS NULL AND m.evidence_count >= ?`,
            args: [params.min_evidence || 5],
          })

          const scored: { predicted: number; actual: number }[] = []
          for (const row of memoriesWithScores.rows) {
            const r = row as unknown as {
              ema_success: number
              ema_failure: number
              outcome: number
            }
            const total = r.ema_success + r.ema_failure
            const predicted = total === 0 ? 0.5 : r.ema_success / total
            scored.push({ predicted, actual: r.outcome })
          }

          const deciles: any[] = []
          for (let i = 0; i < 10; i++) {
            const lo = i / 10
            const hi = (i + 1) / 10
            const inBin = scored.filter((s) => s.predicted >= lo && s.predicted < hi)
            const avgPredicted =
              inBin.length > 0 ? inBin.reduce((sum, s) => sum + s.predicted, 0) / inBin.length : 0
            const avgActual =
              inBin.length > 0 ? inBin.reduce((sum, s) => sum + s.actual, 0) / inBin.length : 0
            deciles.push({
              bin: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
              count: inBin.length,
              avg_predicted: avgPredicted,
              avg_actual: avgActual,
            })
          }

          const calibrationError =
            deciles.reduce((sum, d) => sum + Math.abs(d.avg_predicted - d.avg_actual), 0) /
            deciles.length

          const highTrust = scored.filter((s) => s.predicted >= 0.7)
          const lowTrust = scored.filter((s) => s.predicted <= 0.3)
          const highRate =
            highTrust.length > 0
              ? highTrust.reduce((sum, r) => sum + r.actual, 0) / highTrust.length
              : 0
          const lowRate =
            lowTrust.length > 0
              ? lowTrust.reduce((sum, r) => sum + r.actual, 0) / lowTrust.length
              : 0
          const discrimination = highRate - lowRate

          const allScores: number[] = scored.map((s) => s.predicted).sort((a, b) => a - b)
          const pct = (p: number): number => allScores[Math.floor(allScores.length * p)] || 0

          const staleResult = await database.execute({
            sql: `SELECT COUNT(*) AS cnt FROM memories WHERE deleted_at IS NULL AND datetime(updated_at) < datetime('now', '-30 days')`,
            args: [],
          })
          const staleMemories = (staleResult.rows[0] as any).cnt

          const unprovenResult = await database.execute({
            sql: `SELECT COUNT(*) AS cnt FROM memories WHERE deleted_at IS NULL AND evidence_count < ?`,
            args: [params.min_evidence || 5],
          })
          const unprovenMemories = (unprovenResult.rows[0] as any).cnt

          const avgEvidenceResult = await database.execute({
            sql: `SELECT AVG(evidence_count) AS avg FROM memories WHERE deleted_at IS NULL`,
            args: [],
          })
          const avgEvidence = (avgEvidenceResult.rows[0] as any).avg || 0

          const flags: string[] = []
          if (calibrationError > 0.15) flags.push('calibration is degrading')
          if (discrimination < 0.05 && scored.length > 20)
            flags.push("I can't tell good memories from bad ones")
          if (highRate < lowRate + 0.05 && highTrust.length > 10 && lowTrust.length > 10)
            flags.push('my scores are worse than guessing')
          if (totalMemories > 100 && staleMemories > totalMemories * 0.5)
            flags.push('too many stale memories')

          const trustedCountResult = await database.execute({
            sql: `SELECT COUNT(*) AS cnt FROM memories WHERE deleted_at IS NULL AND evidence_count >= ? AND (ema_success / (ema_success + ema_failure)) >= ?`,
            args: [
              Number(params.min_evidence || 5),
              Number(pct(1 - (Number(params.trust_quantile) || 0.3))),
            ],
          })
          if ((trustedCountResult.rows[0] as any).cnt < 3) flags.push('too few trusted memories')

          const partitionsResult = await database.execute({
            sql: `SELECT DISTINCT task_type FROM memories WHERE deleted_at IS NULL`,
            args: [],
          })
          for (const row of partitionsResult.rows) {
            const p = row as unknown as { task_type: string }
            const partitionOutcomesResult = await database.execute({
              sql: `SELECT outcome FROM outcome_log WHERE task_type = ?`,
              args: [p.task_type],
            })
            if (
              partitionOutcomesResult.rows.length > 0 &&
              partitionOutcomesResult.rows.length < 10
            ) {
              flags.push(`partition "${p.task_type}" has insufficient data`)
            }
          }

          const status =
            flags.length === 0
              ? 'nominal'
              : flags.some((f) => f.includes('worse than guessing') || f.includes("can't tell"))
                ? 'degraded'
                : 'watch'

          return {
            output: JSON.stringify({
              status,
              memories: totalMemories,
              outcomes: totalOutcomes,
              calibration: {
                error: Math.round(calibrationError * 1000) / 1000,
                deciles,
              },
              discrimination: {
                high_trust_rate: Math.round(highRate * 1000) / 1000,
                low_trust_rate: Math.round(lowRate * 1000) / 1000,
                delta: Math.round(discrimination * 1000) / 1000,
              },
              distribution: {
                p5: Math.round(pct(0.05) * 100) / 100,
                p25: Math.round(pct(0.25) * 100) / 100,
                p50: Math.round(pct(0.5) * 100) / 100,
                p75: Math.round(pct(0.75) * 100) / 100,
                p95: Math.round(pct(0.95) * 100) / 100,
              },
              stale_memories: staleMemories,
              unproven_memories: unprovenMemories,
              avg_evidence: Math.round(avgEvidence * 100) / 100,
              tasks_since_last_tune: totalOutcomes,
              flags,
              recommendation: flags.length > 0 ? flags[0] : 'no action needed',
            }),
          }
        },
      }),

      memory_tune: tool({
        description: 'Adjust a tuning knob. Requires a written rationale. Only one knob per call.',
        args: {
          knob: tool.schema
            .string()
            .describe(
              'Knob name: decay_rate, trust_quantile, doubt_quantile, min_evidence, active_partition'
            ),
          value: tool.schema
            .number()
            .optional()
            .describe('New value (not needed for active_partition which takes a string)'),
          rationale: tool.schema.string().describe('One-sentence explanation for this change'),
        },
        async execute(args) {
          const database = await getDb()
          const knob = args.knob
          const rationale = args.rationale?.trim()

          if (!rationale || rationale.length < 10) {
            return {
              output:
                'Error: A rationale of at least 10 characters is required for every tuning change.',
            }
          }

          const currentParams = await getTuningParams(database)
          const oldValues = { ...currentParams }

          if (knob === 'decay_rate') {
            const v = Number(args.value)
            if (isNaN(v) || v <= 0 || v >= 1)
              return { output: 'Error: decay_rate must be between 0 and 1 (exclusive)' }
          } else if (knob === 'trust_quantile') {
            const v = Number(args.value)
            const doubt = Number(currentParams.doubt_quantile ?? 0.3)
            if (isNaN(v) || v <= 0 || v >= 1)
              return { output: 'Error: trust_quantile must be between 0 and 1 (exclusive)' }
            if (v <= doubt)
              return {
                output: `Error: trust_quantile (${v}) must be greater than doubt_quantile (${doubt})`,
              }
          } else if (knob === 'doubt_quantile') {
            const v = Number(args.value)
            const trust = Number(currentParams.trust_quantile ?? 0.3)
            if (isNaN(v) || v <= 0 || v >= 1)
              return { output: 'Error: doubt_quantile must be between 0 and 1 (exclusive)' }
            if (v >= trust)
              return {
                output: `Error: doubt_quantile (${v}) must be less than trust_quantile (${trust})`,
              }
          } else if (knob === 'min_evidence') {
            const v = Number(args.value)
            if (!Number.isInteger(v) || v < 1)
              return { output: 'Error: min_evidence must be a positive integer' }
          } else if (knob === 'active_partition') {
            const v = String(args.value || '').trim()
            if (!v) return { output: 'Error: active_partition requires a non-empty partition name' }
            const partitionsResult = await database.execute({
              sql: `SELECT DISTINCT task_type FROM memories WHERE deleted_at IS NULL`,
              args: [],
            })
            const partitions = partitionsResult.rows as unknown as { task_type: string }[]
            const exists = partitions.some((p) => p.task_type === v)
            if (!exists && partitions.length > 0) {
              return {
                output: `Error: Partition "${v}" does not exist. Existing: ${partitions.map((p) => p.task_type).join(', ')}`,
              }
            }
          } else {
            return {
              output: `Error: Unknown knob: ${knob}. Valid: decay_rate, trust_quantile, doubt_quantile, min_evidence, active_partition`,
            }
          }

          const newValue =
            knob === 'active_partition' ? String(args.value).trim() : Number(args.value)
          await database.execute({
            sql: `INSERT OR REPLACE INTO tuning_params (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
            args: [knob, newValue],
          })

          await database.execute({
            sql: `INSERT INTO tuning_audit (changed_by, rationale, old_values, new_values) VALUES (?, ?, ?, ?)`,
            args: [
              'agent',
              rationale,
              JSON.stringify(oldValues),
              JSON.stringify({ [knob]: newValue }),
            ],
          })

          return { output: JSON.stringify({ tuned: true, knob, new_value: newValue, rationale }) }
        },
      }),

      memory_get_params: tool({
        description: 'Inspect current tuning parameter values.',
        args: {},
        async execute() {
          const database = await getDb()
          const params = await getTuningParams(database)
          return { output: JSON.stringify({ params }) }
        },
      }),

      memory_get_audit: tool({
        description: 'Inspect the tuning audit log. Shows what the agent has changed and why.',
        args: {
          limit: tool.schema.number().optional().describe('Max entries (default 20)'),
        },
        async execute(args) {
          const database = await getDb()
          const limit = args.limit || 20
          const result = await database.execute({
            sql: `SELECT * FROM tuning_audit ORDER BY changed_at DESC LIMIT ?`,
            args: [limit],
          })
          return { output: JSON.stringify({ entries: result.rows }) }
        },
      }),

      memory_reset: tool({
        description:
          'Reset the memory database. Wipes all memories, outcomes, and audit log. Tuning params are preserved.',
        args: {},
        async execute() {
          const database = await getDb()
          const params = await getTuningParams(database)
          await database.close()
          db = null
          const dbFile = path.resolve(pluginDirectory || process.cwd(), MEMORY_DIR, 'memories.db')
          if (fs.existsSync(dbFile)) {
            let retries = 0
            while (retries < 10) {
              try {
                fs.unlinkSync(dbFile)
                break
              } catch (e: any) {
                if (e.code === 'EBUSY' && retries < 9) {
                  await new Promise((r) => setTimeout(r, 50))
                  retries++
                } else {
                  throw e
                }
              }
            }
          }
          const newDb = await getDb()
          await initSchema(newDb)
          for (const p of [
            { key: 'decay_rate', value: params.decay_rate ?? 0.3 },
            { key: 'trust_quantile', value: params.trust_quantile ?? 0.3 },
            { key: 'doubt_quantile', value: params.doubt_quantile ?? 0.3 },
            { key: 'min_evidence', value: params.min_evidence ?? 5 },
            { key: 'active_partition', value: params.active_partition ?? 'general' },
          ]) {
            await newDb.execute({
              sql: `INSERT OR REPLACE INTO tuning_params (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
              args: [p.key, p.value],
            })
          }
          return {
            output: JSON.stringify({
              reset: true,
              message: 'Memory database wiped. Tuning params preserved.',
            }),
          }
        },
      }),
    },
  }
}

export default MemoryWorthPlugin
