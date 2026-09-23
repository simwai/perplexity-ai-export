import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUN, IS_BUN } from './detect.js'
import { hash32 } from './shim/hash-shim.js'
import { readText, writeText } from './shim/file-shim.js'
import { spawnCommand } from './shim/spawn-shim.js'
import { openDatabase } from './shim/sqlite-shim.js'
import { which } from './shim/which-shim.js'
import { runCommand } from './shell.js'

function runtimeBinary(): { cmd: string; flag: string } | null {
  if (which('node')) return { cmd: 'node', flag: '--version' }
  if (which('bun')) return { cmd: 'bun', flag: '--version' }
  return null
}

describe('detect', () => {
  it('reports a boolean runtime with a matching BUN handle', () => {
    assert.equal(typeof IS_BUN, 'boolean')
    assert.equal(IS_BUN ? BUN !== null : BUN === null, true)
  })
})

describe('shims', () => {
  it('round-trips sqlite on the active backend', async () => {
    const db = await openDatabase(':memory:')
    assert.equal(db.kind, IS_BUN ? 'bun' : 'node')
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    db.exec("INSERT INTO probe (name) VALUES ('alpha')")
    const rows = db.queryObjects('SELECT id, name FROM probe WHERE name = ?', ['alpha'])
    assert.equal(rows.length, 1)
    await db.close()
  })

  it('writes and reads text files', async () => {
    const path = join(tmpdir(), `mw-shim-${Date.now()}.txt`)
    await writeText(path, 'shimmed')
    assert.equal(await readText(path), 'shimmed')
  })

  it('spawns processes and captures output', async () => {
    const runtime = runtimeBinary()
    assert.ok(runtime !== null)
    const result = await spawnCommand(runtime.cmd, ['-e', "console.log('hi-shim')"])
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('hi-shim'))
  })

  it('locates executables on PATH', () => {
    assert.ok(which('node') !== null || which('bun') !== null)
  })

  it('hashes deterministically to eight hex chars', () => {
    assert.equal(hash32('memory'), hash32('memory'))
    assert.match(hash32('memory'), /^[0-9a-f]{8}$/)
  })
})

describe('shell', () => {
  it('falls back to execFile without ctx.$', async () => {
    const runtime = runtimeBinary()
    assert.ok(runtime !== null)
    const out = await runCommand({}, runtime.cmd, ['-e', "console.log('hi-shell')"])
    assert.ok(out.includes('hi-shell'))
  })

  it('uses ctx.$ when a shell function is present', async () => {
    const out = await runCommand({ $: async () => ({ stdout: 'hi-bun' }) }, 'echo', ['hi'])
    assert.equal(out, 'hi-bun')
  })
})
