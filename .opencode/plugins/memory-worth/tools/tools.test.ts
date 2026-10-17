import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from '@opencode-ai/plugin'
import { memoryDeleteTool } from './memory-delete.js'
import { memoryGetTool } from './memory-get.js'
import { memoryInvalidateTool } from './memory-invalidate.js'
import { memoryMergeTool } from './memory-merge.js'
import { memorySearchTool } from './memory-search.js'
import { memorySetStatusTool } from './memory-set-status.js'
import { memoryStatsTool } from './memory-stats.js'
import { memorySynthesizeTool } from './memory-synthesize.js'
import { memoryTuneTool } from './memory-tune.js'
import { memoryUpdateTool } from './memory-update.js'
import { memoryWakeupTool } from './memory-wakeup.js'
import { memoryWriteTool } from './memory-write.js'

let directory: string

function context(session: string): ToolContext {
  return {
    sessionID: session,
    messageID: `msg-${session}`,
    agent: 'test',
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  }
}

async function output(
  tool: { execute: (args: never, ctx: ToolContext) => Promise<unknown> },
  args: unknown,
  session: string
): Promise<Record<string, unknown>> {
  const result = (await tool.execute(args as never, context(session))) as { output: string }
  return JSON.parse(result.output) as Record<string, unknown>
}

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'mw-tools-'))
})

after(async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(directory, { recursive: true, force: true })
      return
    } catch {
      if (attempt === 19) {
        // Best-effort cleanup: the native binding can hold the file handle
        // past close() on Windows (EBUSY). Assertions already passed; the OS
        // temp directory reclaims the remainder. Never fail green tests here.
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
})

describe('write', () => {
  it('stores with applies_when and refuses exact duplicates', async () => {
    const first = await output(
      memoryWriteTool,
      {
        content: 'tools sentinel write alpha',
        applies_when: 'tool tests',
        tags: ['tools'],
        task_type: 'testing',
      },
      'tools-s1'
    )
    assert.equal(typeof first['id'], 'number')
    const second = await output(
      memoryWriteTool,
      { content: 'tools sentinel write alpha', applies_when: 'tool tests' },
      'tools-s1'
    )
    assert.equal(second['error'], `duplicate_of:${first['id']}`)
  })

  it('rejects missing applies_when', async () => {
    const result = await output(
      memoryWriteTool,
      { content: 'tools sentinel no applies', applies_when: '   ' },
      'tools-s1b'
    )
    assert.ok(typeof result['error'] === 'string')
  })
})

describe('read', () => {
  it('gets full records and finds them by search', async () => {
    const written = await output(
      memoryWriteTool,
      { content: 'tools sentinel read beta gamma', applies_when: 'tool tests' },
      'tools-s2'
    )
    const id = written['id'] as number
    const fetched = await output(memoryGetTool, { id }, 'tools-s2')
    assert.equal(fetched['content'], 'tools sentinel read beta gamma')
    assert.equal(fetched['trust_label'], 'unproven')
    const results = (await output(
      memorySearchTool,
      { query: 'sentinel read beta', strategy: 'full' },
      'tools-s2'
    )) as unknown as unknown[]
    assert.ok(results.some((row) => (row as { id: number }).id === id))
    const meta = (await output(
      memorySearchTool,
      { query: 'sentinel read beta', strategy: 'metadata' },
      'tools-s2'
    )) as unknown as unknown[]
    const hit = meta.find((row) => (row as { id: number }).id === id) as
      | { content?: string }
      | undefined
    assert.ok(hit !== undefined && hit['content'] === undefined)
  })

  it('synthesizes cited answers with unknowns', async () => {
    await output(
      memoryWriteTool,
      { content: 'tools sentinel synth quinoa', applies_when: 'tool tests' },
      'tools-s3'
    )
    const covered = await output(memorySynthesizeTool, { query: 'quinoa' }, 'tools-s3')
    assert.ok((covered['cited'] as unknown[]).length > 0)
    assert.deepEqual(covered['unknowns'], [])
    const open = await output(memorySynthesizeTool, { query: 'zxqj' }, 'tools-s3')
    assert.deepEqual(open['cited'], [])
    assert.deepEqual(open['unknowns'], ['zxqj'])
  })
})

describe('lifecycle', () => {
  it('updates content while preserving mw', async () => {
    const written = await output(
      memoryWriteTool,
      { content: 'tools sentinel update delta', applies_when: 'tool tests' },
      'tools-s4'
    )
    const id = written['id'] as number
    const before = await output(memoryGetTool, { id }, 'tools-s4')
    const updated = await output(
      memoryUpdateTool,
      { id, content: 'tools sentinel update delta revised', tags: ['rev'] },
      'tools-s4'
    )
    assert.equal(updated['ok'], true)
    const after = await output(memoryGetTool, { id }, 'tools-s4')
    assert.equal(after['content'], 'tools sentinel update delta revised')
    assert.equal(after['mw'], before['mw'])
  })

  it('archives via set_status and excludes from search', async () => {
    const written = await output(
      memoryWriteTool,
      { content: 'tools sentinel archive epsilon', applies_when: 'tool tests' },
      'tools-s5'
    )
    const id = written['id'] as number
    assert.equal(
      (await output(memorySetStatusTool, { id, status: 'archived' }, 'tools-s5'))['ok'],
      true
    )
    const results = (await output(
      memorySearchTool,
      { query: 'sentinel archive epsilon' },
      'tools-s5'
    )) as unknown as unknown[]
    assert.ok(!results.some((row) => (row as { id: number }).id === id))
  })

  it('invalidates with reason and mode', async () => {
    const written = await output(
      memoryWriteTool,
      { content: 'tools sentinel invalidate zeta', applies_when: 'tool tests' },
      'tools-s6'
    )
    const id = written['id'] as number
    assert.deepEqual(
      await output(memoryInvalidateTool, { id, reason: 'superseded', mode: 'correct' }, 'tools-s6'),
      { ok: true, id }
    )
    assert.equal((await output(memoryGetTool, { id }, 'tools-s6'))['status'], 'invalidated')
  })

  it('merges with counter sums and archives the source', async () => {
    const target = await output(
      memoryWriteTool,
      { content: 'tools sentinel merge eta target', applies_when: 'tool tests' },
      'tools-s7'
    )
    const source = await output(
      memoryWriteTool,
      { content: 'tools sentinel merge eta source', applies_when: 'tool tests' },
      'tools-s7'
    )
    const merged = await output(
      memoryMergeTool,
      {
        id_a: target['id'],
        id_b: source['id'],
        merged_content: 'tools sentinel merge eta combined',
      },
      'tools-s7'
    )
    assert.equal(merged['kept'], target['id'])
    assert.equal(merged['removed'], source['id'])
    assert.ok(typeof merged['merged_mw'] === 'number')
    assert.equal(
      (await output(memoryGetTool, { id: source['id'] }, 'tools-s7'))['status'],
      'archived'
    )
  })

  it('deletes permanently', async () => {
    const written = await output(
      memoryWriteTool,
      { content: 'tools sentinel delete theta', applies_when: 'tool tests' },
      'tools-s8'
    )
    const id = written['id'] as number
    assert.equal(
      (await output(memoryDeleteTool, { id, reason: 'test cleanup' }, 'tools-s8'))['ok'],
      true
    )
    assert.ok((await output(memoryGetTool, { id }, 'tools-s8'))['error'] !== undefined)
  })
})

describe('meta', () => {
  it('reports stats with trust distribution', async () => {
    await output(
      memoryWriteTool,
      { content: 'tools sentinel stats iota', applies_when: 'tool tests' },
      'tools-s9'
    )
    const stats = await output(memoryStatsTool, {}, 'tools-s9')
    assert.ok((stats['memories'] as number) >= 1)
    assert.ok((stats['trust_distribution'] as Record<string, number>)['unproven'] !== undefined)
  })

  it('wakes up with a session digest', async () => {
    const digest = await output(memoryWakeupTool, {}, 'tools-s10')
    assert.ok(typeof digest['total'] === 'number')
    assert.ok(Array.isArray(digest['stale']))
  })

  it('validates knobs and restores them afterwards', async () => {
    assert.ok(
      (
        await output(
          memoryTuneTool,
          { knob: 'trust_q', value: '0.2', rationale: 'test invalid ordering' },
          'tools-s11'
        )
      )['error'] !== undefined
    )
    const applied = await output(
      memoryTuneTool,
      { knob: 'active_partition', value: 'tools-part', rationale: 'test partition creation' },
      'tools-s11'
    )
    assert.equal(applied['applied'], true)
    const restored = await output(
      memoryTuneTool,
      { knob: 'active_partition', value: 'auto', rationale: 'restore default after test' },
      'tools-s11'
    )
    assert.equal(restored['applied'], true)
  })
})
