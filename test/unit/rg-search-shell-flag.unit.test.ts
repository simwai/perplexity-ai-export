import { describe, it, expect, vi, beforeEach } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

vi.mock('@vscode/ripgrep', () => ({
  rgPath: '/mock/rg',
}))

vi.mock('node:readline', () => ({
  createInterface: () => ({
    on: vi.fn(),
    close: vi.fn(),
  }),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { RipgrepSearch } from '../../src/search/rg-search.js'

const mockConfig = {
  exportDir: '/tmp/exports',
  debug: false,
}

describe('RipgrepSearch spawn options (Unit)', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => {
      const handlers: Record<string, (...args: unknown[]) => void> = {}
      const child = {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb
        },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
      }
      queueMicrotask(() => {
        handlers['close']?.(0)
      })
      return child
    })
  })

  it('spawns ripgrep with shell disabled (chat-flow H2 fix)', async () => {
    const rg = new RipgrepSearch(mockConfig)
    await rg.captureSearchMatches({ pattern: 'some keyword' })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const callArgs = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>]
    const options = callArgs[2]
    expect(options).toBeDefined()
    expect(options['shell']).toBe(false)
  })

  it('never passes shell:true regardless of pattern content', async () => {
    const rg = new RipgrepSearch(mockConfig)
    const patterns = [
      'simple',
      'with space',
      'with;semicolon',
      'with|pipe',
      'with$var',
      'normal keyword',
    ]
    for (const pattern of patterns) {
      await rg.captureSearchMatches({ pattern })
    }

    for (const call of spawnMock.mock.calls) {
      const options = call[2] as Record<string, unknown>
      expect(options['shell']).toBe(false)
    }
  })
})
