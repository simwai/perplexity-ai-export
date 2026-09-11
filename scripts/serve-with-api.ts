import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { logger } from '../src/utils/logger.js'

// #region Server Setup
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public')
const NOTES_DIR = resolve(PROJECT_ROOT, 'notes')
const PORT = Number(process.env.PORT ?? 9876)

// Per-IP sliding window for the expensive rebuild endpoint. Local dev tool,
// so the cap is generous: bursts of manual clicks pass, tight loops do not.
// Tunable via REGENERATE_MAX_HITS (tests set it to 0 for a build-free probe).
const REGENERATE_WINDOW_MS = 60_000
const regenerateHits = new Map<string, number[]>()

function regenerateMaxHits(): number {
  return Number(process.env.REGENERATE_MAX_HITS ?? 5)
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
// #endregion Server Setup

// #region Build Runner
interface BuildResult {
  stdout: string
  stderr: string
  code: number | null
}

function runBuildGraph(): Promise<BuildResult> {
  return new Promise((resolvePromise, reject) => {
    const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const proc = spawn(cmd, ['build:graph'], {
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: unknown) => {
      stdout += String(d)
    })
    proc.stderr.on('data', (d: unknown) => {
      stderr += String(d)
    })
    proc.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr, code })
      else reject(new Error(`build:graph exited with code ${String(code)}\n${stderr}`))
    })
    proc.on('error', reject)
  })
}

function regenerateAllowed(ip: string): boolean {
  const now = Date.now()
  const hits = (regenerateHits.get(ip) ?? []).filter((t) => now - t < REGENERATE_WINDOW_MS)
  if (hits.length >= regenerateMaxHits()) {
    regenerateHits.set(ip, hits)
    return false
  }
  hits.push(now)
  regenerateHits.set(ip, hits)
  return true
}
// #endregion Build Runner

// #region Request Handling
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function serveFile(res: ServerResponse, filePath: string, baseDir: string): void {
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  createReadStream(filePath).pipe(res)
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  if (pathname === '/api/regenerate' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (!regenerateAllowed(ip)) {
      sendJson(res, 429, { success: false, error: 'Rate limited: try again in a minute' })
      return
    }
    runBuildGraph().then(
      (result) => sendJson(res, 200, { success: true, stdout: result.stdout }),
      (err: unknown) =>
        sendJson(res, 500, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
    )
    return
  }

  if (pathname.startsWith('/notes/')) {
    const relPath = decodeURIComponent(pathname.slice('/notes/'.length))
    const filePath = join(NOTES_DIR, relPath)
    serveFile(res, filePath, NOTES_DIR)
    return
  }

  const staticPath = pathname === '/' ? '/index.html' : pathname
  serveFile(res, join(PUBLIC_DIR, staticPath), PUBLIC_DIR)
})
// #endregion Request Handling

// #region Main
export function startMapServer(port: number = PORT) {
  server.listen(port, () => {
    const address = server.address()
    const actual = typeof address === 'object' && address !== null ? address.port : port
    logger.success('Serving Knowledge Map!')
    logger.info(`Local: http://localhost:${String(actual)}`)
    logger.info('API:   POST /api/regenerate')
    logger.info('Notes: /notes/<file>.md')
  })
  return server
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  startMapServer()
}
// #endregion Main
