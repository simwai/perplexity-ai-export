import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Request, Response } from '@playwright/test'
import { config } from './config.js'

const LOGS_DIRECTORY = 'logs'
const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const HTTP_LOG_FILENAME = `http-req-res-log-${LOG_FILE_TIMESTAMP}.txt`
const HTTP_LOG_PATH = join(LOGS_DIRECTORY, HTTP_LOG_FILENAME)

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key']
const PROMPT_KEYWORDS = ['"query"', '"prompt"', '"messages"']

function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const redactedHeaders = { ...headers }

  for (const headerKey of SENSITIVE_HEADERS) {
    if (redactedHeaders[headerKey]) {
      redactedHeaders[headerKey] = '[REDACTED]'
    }
  }
  return redactedHeaders
}

function isPromptRequest(url: string, postData: string | null): boolean {
  const isPerplexityAiApi = url.includes('/backend-api/chat') || url.includes('/api/v1/chat')
  if (isPerplexityAiApi) return true

  if (postData) {
    try {
      const parsedPostData = JSON.parse(postData)
      const hasPromptFields =
        parsedPostData.query ||
        parsedPostData.prompt ||
        (parsedPostData.messages && Array.isArray(parsedPostData.messages))
      if (hasPromptFields) {
        return true
      }
    } catch {
      const containsPromptKeyword = PROMPT_KEYWORDS.some((keyword) => postData.includes(keyword))
      if (containsPromptKeyword) {
        return true
      }
    }
  }
  return false
}

function ensureLogsDirectoryExists(): void {
  if (!existsSync(LOGS_DIRECTORY)) {
    mkdirSync(LOGS_DIRECTORY, { recursive: true })
  }
}

export async function logHttpRequest(request: Request): Promise<void> {
  if (!config.debug) return

  ensureLogsDirectoryExists()

  const requestUrl = request.url()
  const requestMethod = request.method()
  const sanitizedHeaders = redactSensitiveHeaders(request.headers())
  const rawPostData = request.postData()

  const requestBody = isPromptRequest(requestUrl, rawPostData) ? '[PROMPT REDACTED]' : rawPostData

  const logTimestamp = new Date().toISOString()
  const logEntry = [
    `[${logTimestamp}] REQUEST: ${requestMethod} ${requestUrl}`,
    `Headers: ${JSON.stringify(sanitizedHeaders, null, 2)}`,
    `Body: ${requestBody ?? 'None'}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}

export async function logHttpResponse(response: Response): Promise<void> {
  if (!config.debug) return

  const originalRequest = response.request()
  const responseUrl = originalRequest.url()
  const responseStatus = response.status()
  const sanitizedHeaders = redactSensitiveHeaders(response.headers())

  let responseBody = '[BODY SKIPPED]'

  const contentType = sanitizedHeaders['content-type'] ?? ''
  const isJsonContent = contentType.includes('application/json')
  const isPrompt = isPromptRequest(responseUrl, originalRequest.postData())

  if (isJsonContent && !isPrompt) {
    try {
      const jsonResponse = await response.json()
      responseBody = JSON.stringify(jsonResponse, null, 2)
    } catch {
      responseBody = '[COULD NOT PARSE JSON BODY]'
    }
  }

  const logTimestamp = new Date().toISOString()
  const logEntry = [
    `[${logTimestamp}] RESPONSE: ${responseStatus} ${responseUrl}`,
    `Headers: ${JSON.stringify(sanitizedHeaders, null, 2)}`,
    `Body: ${responseBody}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}
