import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Request, Response } from '@playwright/test'
import { config } from './config.js'

const LOGS_DIR = 'logs'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const HTTP_LOG_PATH = join(LOGS_DIR, `http-req-res-log-${TIMESTAMP}.txt`)

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers }
  const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-api-key']

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]'
    }
  }
  return sanitized
}

function isPromptRequest(url: string, postData: string | null): boolean {
  // Perplexity specific prompt detection (heuristics based on typical API patterns)
  const isAiRequest = url.includes('/backend-api/chat') || url.includes('/api/v1/chat')
  if (isAiRequest) return true

  if (postData) {
    try {
      const parsed = JSON.parse(postData)
      // Check for common prompt fields
      if (parsed.query || parsed.prompt || (parsed.messages && Array.isArray(parsed.messages))) {
        return true
      }
    } catch {
      // Not JSON or failed to parse, fallback to string check
      if (
        postData.includes('"query"') ||
        postData.includes('"prompt"') ||
        postData.includes('"messages"')
      ) {
        return true
      }
    }
  }
  return false
}

export async function logHttpRequest(request: Request): Promise<void> {
  if (!config.diagnosisMode) return

  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }

  const url = request.url()
  const method = request.method()
  const headers = sanitizeHeaders(request.headers())
  const postData = request.postData()

  let body = postData
  if (isPromptRequest(url, postData)) {
    body = '[PROMPT REDACTED]'
  }

  const logEntry = [
    `[${new Date().toISOString()}] REQUEST: ${method} ${url}`,
    `Headers: ${JSON.stringify(headers, null, 2)}`,
    `Body: ${body ?? 'None'}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}

export async function logHttpResponse(response: Response): Promise<void> {
  if (!config.diagnosisMode) return

  const request = response.request()
  const url = request.url()
  const status = response.status()
  const headers = sanitizeHeaders(response.headers())

  let body = '[BODY SKIPPED]'

  // We only log bodies for small JSON responses that aren't prompts to keep logs manageable
  const contentType = headers['content-type'] ?? ''
  if (contentType.includes('application/json') && !isPromptRequest(url, request.postData())) {
    try {
      const json = await response.json()
      body = JSON.stringify(json, null, 2)
    } catch {
      body = '[COULD NOT PARSE JSON BODY]'
    }
  }

  const logEntry = [
    `[${new Date().toISOString()}] RESPONSE: ${status} ${url}`,
    `Headers: ${JSON.stringify(headers, null, 2)}`,
    `Body: ${body}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}
