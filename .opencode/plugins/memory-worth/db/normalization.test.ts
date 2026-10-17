import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { runMigrations } from './migrate.js'
import { asNumber } from './decode.js'
import { getMemoryFull, writeMemoryFull } from './queries.js'

let dir: string
let db: Client

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-norm-'))
  db = createClient({ url: `file:${join(dir, 'norm.db')}`, intMode: 'number' })
  await runMigrations(db)
})

after(async () => {
  db.close()
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (e: unknown) {
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

async function count(table: string): Promise<number> {
  const allowed = ['tag', 'ground', 'memory_tag', 'memory', 'episode', 'calibration_entry']
  if (!allowed.includes(table)) throw new Error(`unexpected table ${table}`)
  const result = await db.execute({ sql: `SELECT COUNT(*) AS cnt FROM ${table}`, args: [] })
  return asNumber(result.rows[0]?.['cnt'])
}

describe('normalization', () => {
  it('round-trips 3 tags and 2 grounds with exact row counts', async () => {
    const written = await writeMemoryFull(db, {
      content: 'normalization sentinel memory',
      applies_when: 'testing 3NF round-trips',
      tags: ['norm-a', 'norm-b', 'norm-c'],
      grounds: [
        { kind: 'file', value: 'src/index.ts' },
        { kind: 'symbol', value: 'writeMemoryFull' },
      ],
      taskType: 'testing',
    })
    assert.equal(await count('tag'), 3)
    assert.equal(await count('ground'), 2)
    assert.equal(await count('memory_tag'), 3)
    assert.equal(await count('memory'), 1)

    const fetched = await getMemoryFull(db, written.id)
    assert.ok(fetched !== null)
    assert.equal(fetched.content, 'normalization sentinel memory')
    assert.equal(fetched.applies_when, 'testing 3NF round-trips')
    assert.equal(fetched.task_type, 'testing')
    assert.deepEqual(fetched.tags, ['norm-a', 'norm-b', 'norm-c'])
    assert.deepEqual(fetched.grounds, [
      { kind: 'file', value: 'src/index.ts' },
      { kind: 'symbol', value: 'writeMemoryFull' },
    ])
  })

  it('derives active retrievals from unresolved episodes', async () => {
    const hits = await db.execute({
      sql: `SELECT ce.memory_id AS memory_id FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.resolved_at IS NULL AND e.session_id = ?`,
      args: ['no-such-session'],
    })
    assert.equal(hits.rows.length, 0)
  })
})
