import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

function stubStorageEnv(root: string): void {
  vi.stubEnv('AUTH_STORAGE_PATH', join(root, '.storage', 'auth.json'))
  vi.stubEnv('CHECKPOINT_PATH', join(root, '.storage', 'checkpoint.json'))
  vi.stubEnv('VECTOR_INDEX_PATH', join(root, '.storage', 'vector-index'))
  vi.stubEnv('EXPORT_DIR', join(root, 'exports'))
}

async function importFreshConfig(
  root: string
): Promise<typeof import('../../src/utils/config.js')> {
  vi.resetModules()
  vi.unstubAllEnvs()
  stubStorageEnv(root)
  return import('../../src/utils/config.js')
}

describe('config', () => {
  it('defaults structured JSON on and optional sidecars off', async () => {
    const root = mkdtempSync(join(tmpdir(), 'perplexity-config-'))
    const { config } = await importFreshConfig(root)

    expect(config.waitMode).toBe('static')
    expect(config.exportStructuredJson).toBe(true)
    expect(config.exportMarkdown).toBe(false)
    expect(config.structuredExportDir).toBe(config.exportDir)
    expect(config.enableVectorSearch).toBe(false)
    expect(config.headless).toBe(false)
  })

  it('honors explicit export and vector settings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'perplexity-config-'))
    vi.resetModules()
    vi.unstubAllEnvs()
    stubStorageEnv(root)
    vi.stubEnv('STRUCTURED_EXPORT_DIR', join(root, 'structured'))
    vi.stubEnv('EXPORT_STRUCTURED_JSON', 'false')
    vi.stubEnv('EXPORT_MARKDOWN', 'true')
    vi.stubEnv('ENABLE_VECTOR_SEARCH', 'true')

    const { config } = await import('../../src/utils/config.js')

    expect(config.structuredExportDir).toBe(join(root, 'structured'))
    expect(config.exportStructuredJson).toBe(false)
    expect(config.exportMarkdown).toBe(true)
    expect(config.enableVectorSearch).toBe(true)
  })
})
