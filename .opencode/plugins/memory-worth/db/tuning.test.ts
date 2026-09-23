import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { runMigrations } from './migrate.js'
import { getParameter, previewParameterChange, setParameter } from './queries.js'

let dir: string
let db: Client

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-tune-'))
  db = createClient({ url: `file:${join(dir, 'tune.db')}`, intMode: 'number' })
  await runMigrations(db)
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

describe('tuning', () => {
  it('rejects out-of-range knobs without writing', async () => {
    const preview = previewParameterChange('trust_q', '1.5', { trust_q: '0.70' })
    assert.equal(preview.ok, false)
    assert.equal(await getParameter(db, 'trust_q', '0.70'), '0.70')
  })

  it('rejects trust below doubt without writing', async () => {
    const preview = previewParameterChange('trust_q', '0.2', { trust_q: '0.70', doubt_q: '0.30' })
    assert.equal(preview.ok, false)
  })

  it('accepts valid knobs with previous value', async () => {
    const preview = previewParameterChange('min_evidence', '10', { min_evidence: '3' })
    assert.equal(preview.ok, true)
    assert.equal(preview.previous, '3')
  })

  it('writes staged changes via setParameter with audit', async () => {
    const staged = await setParameter(db, 'min_evidence', '10', 'stage tuning test')
    assert.equal(staged.previous, '3')
    const audit = await db.execute({
      sql: `SELECT knob, old_value, new_value FROM parameter_change WHERE knob = 'min_evidence' ORDER BY id DESC LIMIT 1`,
      args: [],
    })
    assert.equal(audit.rows.length, 1)
  })
})
