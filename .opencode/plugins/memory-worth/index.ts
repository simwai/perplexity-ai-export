import type { Plugin } from '@opencode-ai/plugin'
import { createConnection, getDbPath } from './db/connection.js'
import { ensureTaskType, getTuningParams } from './db/queries.js'
import { handleCompacting } from './hooks/compacting.js'
import { handleSessionCreated, handleSessionDeleted } from './hooks/session-events.js'
import { recordOutcome } from './hooks/tool-execute-after.js'
import { classifyOutcome, isOutcomeSignal } from './outcome.js'
import { detectRuntime } from './runtime/detect.js'
import { fromAsync, isErr } from './core/result.js'
import {
  memoryDeleteTool,
  memoryGetTool,
  memoryInvalidateTool,
  memoryMergeTool,
  memorySearchTool,
  memorySetStatusTool,
  memoryStatsTool,
  memorySynthesizeTool,
  memoryTuneTool,
  memoryUpdateTool,
  memoryWakeupTool,
  memoryWriteTool,
} from './tools/index.js'

function readSessionId(properties: unknown): string | undefined {
  if (typeof properties !== 'object' || properties === null) return undefined
  if (!('sessionID' in properties)) return undefined
  const value = (properties as { sessionID: unknown }).sessionID
  return typeof value === 'string' ? value : undefined
}

const MemoryWorthPlugin: Plugin = async ({ client, directory }) => {
  const db = await createConnection(directory)
  const runtime = detectRuntime()
  const logged = await fromAsync(() =>
    client.app.log({
      body: {
        service: 'memory-worth',
        level: 'info',
        message: `memory-worth ready on ${runtime} with database at ${getDbPath(directory)}`,
      },
    })
  )
  if (isErr(logged)) {
    // logging is best-effort and must not break plugin startup
  }

  return {
    event: async ({ event }) => {
      const evt = event as unknown as { type: string; properties?: unknown }
      if (evt.type === 'session.created') {
        await handleSessionCreated(db)
        return
      }
      if (evt.type === 'session.deleted') {
        const sessionId = readSessionId(evt.properties)
        if (sessionId) await handleSessionDeleted(db, sessionId)
      }
    },

    'experimental.chat.system.transform': async ({ sessionID }, { system }) => {
      if (!sessionID) return
      system.push(
        `MEMORY-WORTH (${runtime}): you have persistent memory tools. Search memory before answering when prior context could help; store durable insights with memory_write; prefer updating over duplicating. Trust labels are associational: high means co-occurred with success, low means co-occurred with failure, unproven means insufficient evidence.`
      )
    },

    'tool.execute.after': async (input, output) => {
      const text = typeof output.output === 'string' ? output.output : ''
      if (!isOutcomeSignal(text)) return
      const outcome = classifyOutcome(text) === 'success'
      const params = await getTuningParams(db)
      const taskTypeId = await ensureTaskType(db, params.active_partition)

      const retrieved = await db.execute({
        sql: `SELECT memory_id AS memory_id FROM session_memory WHERE session_id = ? ORDER BY retrieved_at DESC`,
        args: [input.sessionID],
      })
      for (const row of retrieved.rows) {
        const value = row['memory_id']
        const memoryId =
          typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0
        if (memoryId) await recordOutcome(db, input.sessionID, memoryId, outcome, taskTypeId)
      }
      await db.execute({
        sql: `DELETE FROM session_memory WHERE session_id = ?`,
        args: [input.sessionID],
      })
    },

    'experimental.session.compacting': async (input, output) => {
      await handleCompacting(db, input.sessionID)
      output.context.push(
        'memory-worth: session retrieval ledger cleared; long-term memories remain in the database.'
      )
    },

    tool: {
      memory_search: memorySearchTool,
      memory_get: memoryGetTool,
      memory_synthesize: memorySynthesizeTool,
      memory_wakeup: memoryWakeupTool,
      memory_write: memoryWriteTool,
      memory_update: memoryUpdateTool,
      memory_invalidate: memoryInvalidateTool,
      memory_merge: memoryMergeTool,
      memory_delete: memoryDeleteTool,
      memory_set_status: memorySetStatusTool,
      memory_stats: memoryStatsTool,
      memory_tune: memoryTuneTool,
    },
  }
}

export default MemoryWorthPlugin
