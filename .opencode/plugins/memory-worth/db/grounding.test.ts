import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { runMigrations } from './migrate.js'
import { getMemoryFull, sweepGrounds, writeMemoryFull } from './queries.js'

let dir: string
let db: Client
let groundedId: number
let ungroundedId: number

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mw-ground-'))
  db = createClient({ url: `file:${join(dir, 'ground.db')}`, intMode: 'number' })
  await runMigrations(db)
  groundedId = (
    await writeMemoryFull(db, {
      content: 'grounding sentinel alpha',
      applies_when: 'artifact grounding tests',
      grounds: [
        { kind: 'file', value: 'src/grounded.ts' },
        { kind: 'symbol', value: 'alphaHelper' },
      ],
      taskType: 'testing',
    })
  ).id
  ungroundedId = (
    await writeMemoryFull(db, {
      content: 'grounding sentinel beta',
      applies_when: 'artifact grounding tests',
      grounds: [
        { kind: 'file', value: 'src/safe.ts' },
        { kind: 'symbol', value: 'betaHelper' },
      ],
      taskType: 'testing',
    })
  ).id
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

describe('grounding', () => {
  it('invalidates memories whose grounded symbols changed', async () => {
    const changed = await sweepGrounds(db, ['alphaHelper', 'src/grounded.ts'])
    assert.equal(changed, 1)
    const mutated = await getMemoryFull(db, groundedId)
    assert.equal(mutated?.status, 'invalidated')
  })

  it('leaves untouched grounds alone', async () => {
    const untouched = await getMemoryFull(db, ungroundedId)
    assert.equal(untouched?.status, 'active')
  })

  it('ignores empty change lists', async () => {
    assert.equal(await sweepGrounds(db, []), 0)
  })
})
