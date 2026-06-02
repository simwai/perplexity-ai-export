import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Request, Response } from 'patchright'
import { errorBus } from './error-bus.js'

const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const HTTP_LOG_FILENAME = `http-req-res-log-${LOG_FILE_TIMESTAMP}.txt`
const HTTP_LOG_PATH = join(LOGS_DIRECTORY, HTTP_LOG_FILENAME)

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key']
const PROMPT_KEYWORDS = ['"query"', '"prompt"', '"messages"']

function redact(headers: Record<string, string>): Record<string, string> {
  const r = { ...headers }
  for (const k of SENSITIVE_HEADERS) if (r[k]) r[k] = '[REDACTED]'
  return r
}

function isPrompt(url: string, data: string | null): boolean {
  if (url.includes('/chat')) return true
  if (data) {
    try {
      const p = JSON.parse(data)
      return !!(p.query || p.prompt || (p.messages && Array.isArray(p.messages)))
    } catch {
      return PROMPT_KEYWORDS.some(k => data.includes(k))
    }
  }
  return false
}

export function logHttpRequest(req: Request, debug: boolean): void {
  if (!debug) return
  try {
    if (!existsSync(LOGS_DIRECTORY)) mkdirSync(LOGS_DIRECTORY, { recursive: true })

    const body = isPrompt(req.url(), req.postData()) ? '[PROMPT REDACTED]' : req.postData()
    const entry = `[${new Date().toISOString()}] REQUEST: ${req.method()} ${req.url()}\n` +
      `Headers: ${JSON.stringify(redact(req.headers()), null, 2)}\n` +
      `Body: ${body ?? 'None'}\n` +
      '--------------------------------------------------------------------------------\n'
    appendFileSync(HTTP_LOG_PATH, entry)
  } catch (e) {
    errorBus.emitError('HTTP Request log failed', e)
  }
}

export async function logHttpResponse(res: Response, debug: boolean): Promise<void> {
  if (!debug) return
  try {
    const req = res.request()
    let body = '[BODY SKIPPED]'
    const ct = res.headers()['content-type'] ?? ''
    if (ct.includes('json') && !isPrompt(req.url(), req.postData())) {
      try { body = JSON.stringify(await res.json(), null, 2) } catch { body = '[PARSE ERROR]' }
    }

    const entry = `[${new Date().toISOString()}] RESPONSE: ${res.status()} ${res.url()}\n` +
      `Headers: ${JSON.stringify(redact(res.headers()), null, 2)}\n` +
      `Body: ${body}\n` +
      '--------------------------------------------------------------------------------\n'
    appendFileSync(HTTP_LOG_PATH, entry)
  } catch (e) {
    errorBus.emitError('HTTP Response log failed', e)
  }
}
