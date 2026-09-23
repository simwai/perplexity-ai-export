import type { Plugin } from '@opencode-ai/plugin'
import { createConnection, getDbPath } from './db/connection.js'
import { buildInjectionTexts } from './hooks/chat-message.js'
import { buildCompactionContext } from './hooks/compacting.js'
import { handleSessionCreated, handleSessionIdle } from './hooks/session-events.js'
import { resolveSessionOutcome } from './hooks/tool-execute-after.js'
import { buildSystemPrompt } from './prompt.js'
import { IS_BUN } from './runtime/detect.js'
import { fromAsync, isErr, isRecord } from './core/result.js'
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
  if (!isRecord(properties) || !('sessionID' in properties)) return undefined
  const value = properties['sessionID']
  return typeof value === 'string' ? value : undefined
}

const injectedSessions = new Set<string>()

const MemoryWorthPlugin: Plugin = async ({ client, directory }) => {
  const db = await createConnection(directory)
  const runtime = IS_BUN ? 'bun' : 'node'
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
        if (sessionId) injectedSessions.delete(sessionId)
        return
      }
      if (evt.type === 'session.idle') {
        const sessionId = readSessionId(evt.properties)
        if (sessionId) await handleSessionIdle(db, sessionId)
        return
      }
      if (evt.type === 'session.compacted') {
        const sessionId = readSessionId(evt.properties)
        if (sessionId) await handleSessionIdle(db, sessionId)
      }
    },

    'chat.message': async (input, output) => {
      const sessionId = input.sessionID
      if (!sessionId) return
      const isFirst = !injectedSessions.has(sessionId)
      const texts = await buildInjectionTexts(db, sessionId, isFirst)
      if (texts.length === 0) return
      injectedSessions.add(sessionId)
      const messageId = input.messageID ?? `memory-worth-${sessionId}`
      const systemPart = {
        id: `memory-worth-system-${sessionId}`,
        sessionID: sessionId,
        messageID: messageId,
        type: 'text' as const,
        text: buildSystemPrompt(),
      }
      const memoryParts = texts.map((text, index) => ({
        id: `memory-worth-digest-${sessionId}-${index}`,
        sessionID: sessionId,
        messageID: messageId,
        type: 'text' as const,
        text,
      }))
      output.parts.push(systemPart, ...memoryParts)
    },

    'tool.execute.after': async (input, output) => {
      const text = typeof output.output === 'string' ? output.output : ''
      await resolveSessionOutcome(db, input.sessionID, text)
    },

    'experimental.session.compacting': async (input, output) => {
      const lines = await buildCompactionContext(db, input.sessionID)
      for (const line of lines) {
        output.context.push(line)
      }
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
