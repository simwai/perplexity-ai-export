import { describe, it, expect, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { startMapServer } from '../../scripts/serve-with-api.js'

describe('serve-with-api', () => {
  let server: Server
  let baseUrl: string

  it('should start on an ephemeral port', async () => {
    server = startMapServer(0)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('no address')
    baseUrl = `http://127.0.0.1:${String(address.port)}`
    expect(address.port).toBeGreaterThan(0)
  })

  it('should serve the knowledge map entry point', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    await res.arrayBuffer()
  })

  it('should block notes path traversal', async () => {
    const res = await fetch(`${baseUrl}/notes/%2e%2e/%2e%2e/package.json`)
    expect([403, 404]).toContain(res.status)
    await res.arrayBuffer()
  })

  it('should return 404 for missing static files', async () => {
    const res = await fetch(`${baseUrl}/nope-missing.json`)
    expect(res.status).toBe(404)
    await res.arrayBuffer()
  })

  it('should answer CORS preflight', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    await res.arrayBuffer()
  })

  it('should rate-limit the rebuild endpoint without building', async () => {
    process.env.REGENERATE_MAX_HITS = '0'
    try {
      const res = await fetch(`${baseUrl}/api/regenerate`, { method: 'POST' })
      expect(res.status).toBe(429)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(false)
    } finally {
      delete process.env.REGENERATE_MAX_HITS
    }
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })
})
