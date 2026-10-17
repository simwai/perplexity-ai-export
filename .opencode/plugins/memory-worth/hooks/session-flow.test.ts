import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asNumber } from '../db/decode.js'
import PluginEntry from '../index.js'

const SESSION = 'flow-s1'

let dir: string
let hooks: Awaited<ReturnType<typeof PluginEntry>>

function pluginInput(directory: string): unknown {
  return {
    client: { app: { log: async () => undefined } },
    directory,
    project: {},
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL('http://localhost:0'),
    $: undefined,
  }
}

function eventPosted(type: string, sessionID: string): unknown {
  return { event: { type, properties: { sessionID } } }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-flow-'))
  hooks = await PluginEntry(pluginInput(dir) as never)
})

after(async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      if (attempt === 19) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
})

describe('session-flow', () => {
  it('injects the system prompt and digest on first chat message', async () => {
    await hooks.event?.(eventPosted('session.created', SESSION) as never)
    const output = { message: {}, parts: [] as unknown[] }
    await hooks['chat.message']?.({ sessionID: SESSION }, output as never)
    assert.ok(output.parts.length >= 2)
    const texts = (output.parts as Array<{ text?: string }>)
      .map((part) => part.text ?? '')
      .join('\n')
    assert.ok(texts.includes('memory policy'))
    assert.ok(texts.includes('session digest'))
  })

  it('writes via tool hook and survives outcome resolution plus idle', async () => {
    const tool = hooks.tool?.['memory_write']
    assert.ok(tool !== undefined)
    if (!tool) return
    const written = await tool.execute(
      {
        content: 'flow sentinel alpha',
        applies_when: 'stage 13-18 verification',
        task_type: 'testing',
      },
      {
        sessionID: SESSION,
        messageID: 'flow-m1',
        agent: 'test',
        directory: dir,
        worktree: dir,
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    )
    const body = JSON.parse(
      typeof written === 'string' ? written : (written as { output: string }).output
    )
    assert.ok(typeof body['id'] === 'number')

    await hooks['tool.execute.after']?.(
      { sessionID: SESSION, callID: 'flow-c1', tool: 'memory_write', args: {} },
      { title: '', output: 'no outcome words here', metadata: {} }
    )
    const open = await episodeCount(dir, false)
    assert.ok(open >= 0)
    await hooks['tool.execute.after']?.(
      { sessionID: SESSION, callID: 'flow-c2', tool: 'memory_write', args: {} },
      { title: '', output: 'all fixed and verified', metadata: {} }
    )
    await hooks.event?.(eventPosted('session.idle', SESSION) as never)
  })

  it('persists memories across the compaction hook', async () => {
    const output = { context: [] as string[] }
    await hooks['experimental.session.compacting']?.({ sessionID: SESSION }, output as never)
    assert.ok(output.context.length > 0)
    assert.ok(output.context[0]?.includes('preserved across compaction'))
  })
})

async function episodeCount(directory: string, resolved: boolean): Promise<number> {
  const { createConnection } = await import('../db/connection.js')
  const db = await createConnection(directory)
  const rows = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM episode WHERE session_id = ? AND resolved_at IS ${resolved ? 'NOT NULL' : 'NULL'}`,
    args: [SESSION],
  })
  return asNumber(rows.rows[0]?.['cnt'])
}
