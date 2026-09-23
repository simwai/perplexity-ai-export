import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { runMigrations } from './migrate.js'
import {
  ensureTaskType,
  getMemory,
  getTuningParams,
  searchMemories,
  updateTrustScore,
  writeMemory,
} from './queries.js'

const TASK = 'rt-task'
const CONTENT = 'roundtrip sentinel alpha memory for isolated database verification'

let dir: string
let db: Client

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-roundtrip-'))
  db = createClient({ url: `file:${join(dir, 'roundtrip.db')}`, intMode: 'number' })
  await runMigrations(db)
})

after(async () => {
  db.close()
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (e: unknown) {
      if (attempt === 19) throw e
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
})

describe('round-trip', () => {
  it('writes and reads back a memory with its task type', async () => {
    const written = await writeMemory(db, { content: CONTENT, tags: 'rt, alpha' }, TASK, 'active')
    const fetched = await getMemory(db, written.id)
    assert.ok(fetched !== null)
    assert.equal(fetched.content, CONTENT)
    assert.equal(fetched.tags, 'rt,alpha')
    assert.equal(fetched.task_type, TASK)
    assert.equal(fetched.evidence_count, 0)
  })

  it('search returns stored task types', async () => {
    const unfiltered = await searchMemories(db, 'roundtrip sentinel', 10)
    const hit = unfiltered.find((row) => row.content === CONTENT)
    assert.ok(hit !== undefined)
    assert.equal(hit.task_type, TASK)
    const filtered = await searchMemories(db, 'roundtrip sentinel', 10, TASK)
    assert.ok(filtered.some((row) => row.content === CONTENT))
  })

  it('records outcomes and updates trust evidence', async () => {
    const written = await writeMemory(
      db,
      { content: 'roundtrip outcome probe memory', tags: 'rt' },
      TASK,
      'active'
    )
    const taskTypeId = await ensureTaskType(db, TASK)
    await updateTrustScore(db, written.id, true, taskTypeId)
    const fetched = await getMemory(db, written.id)
    assert.ok(fetched !== null)
    assert.equal(fetched.evidence_count, 1)
    assert.ok(fetched.trust_score > 0.5)
  })

  it('seeds governance tuning params through migrations', async () => {
    const params = await getTuningParams(db)
    assert.equal(params.decay_rate, 0.3)
    assert.equal(params.min_evidence, 5)
  })
})
