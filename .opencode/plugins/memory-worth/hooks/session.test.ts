import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { asNumber } from '../db/decode.js'
import { runMigrations } from '../db/migrate.js'
import { writeMemoryFull } from '../db/queries.js'
import { searchMemoriesFull } from '../db/queries.js'
import { buildInjectionTexts } from './chat-message.js'
import { buildCompactionContext } from './compacting.js'
import { handleSessionCreated, handleSessionIdle } from './session-events.js'
import { resolveSessionOutcome } from './tool-execute-after.js'

const SESSION = 'session-test-s1'

let dir: string
let db: Client

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-session-'))
  db = createClient({ url: `file:${join(dir, 'session.db')}`, intMode: 'number' })
  await runMigrations(db)
  await handleSessionCreated(db)
  await writeMemoryFull(db, {
    content: 'session sentinel alpha memory',
    applies_when: 'session tests',
    taskType: 'testing',
  })
  await writeMemoryFull(db, {
    content: 'session sentinel beta memory',
    applies_when: 'session tests',
    taskType: 'testing',
  })
})

after(async () => {
  db.close()
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

describe('session', () => {
  it('injects once per session', async () => {
    const first = await buildInjectionTexts(db, SESSION, true)
    assert.ok(first.length > 0)
    assert.ok(first[0]?.includes('session digest'))
    assert.deepEqual(await buildInjectionTexts(db, SESSION, false), [])
  })

  it('records calibration entries on search and resolves on outcome', async () => {
    const hits = await searchMemoriesFull(db, 'session sentinel', { limit: 5, sessionId: SESSION })
    assert.equal(hits.length, 2)
    const idle = await handleSessionIdle(db, SESSION)
    assert.equal(idle.kept, 1)
    assert.equal(idle.discarded, 0)
    const quiet = await resolveSessionOutcome(db, SESSION, 'hello there')
    assert.equal(quiet.resolved, false)
    const resolved = await resolveSessionOutcome(db, SESSION, 'all fixed and verified')
    assert.equal(resolved.resolved, true)
    const episodes = await db.execute({
      sql: `SELECT resolved_at AS resolved_at, outcome AS outcome FROM episode WHERE session_id = ?`,
      args: [SESSION],
    })
    assert.ok(episodes.rows.length > 0)
    for (const row of episodes.rows) {
      assert.ok(row['resolved_at'] !== null)
    }
    const memories = await db.execute({
      sql: `SELECT mw AS mw FROM memory WHERE content LIKE 'session sentinel%'`,
      args: [],
    })
    for (const row of memories.rows) {
      assert.ok(asNumber(row['mw']) > 0.5)
    }
  })

  it('discards empty episodes on idle and reports compaction context', async () => {
    const empty = await handleSessionIdle(db, 'session-test-empty')
    assert.equal(empty.discarded, 0)
    assert.equal(empty.kept, 0)
    const lines = await buildCompactionContext(db, SESSION)
    assert.ok(lines.length > 0)
    assert.ok(lines[0]?.includes('preserved across compaction'))
  })
})
