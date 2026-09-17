import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Request, Response } from '@playwright/test'
import { from } from 'super-result'
import { z } from 'zod'
import { ApiDiagnosticsWriter } from './api-diagnostics.js'
import { LOGS_DIRECTORY, LOG_FILE_TIMESTAMP } from '../log-constants.js'

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|cookie|password|api[_-]?key|access[_-]?token|bearer/i

const PromptPostDataSchema = z
  .object({
    query: z.string().optional(),
    prompt: z.string().optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough()

function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return obj.map(redactSensitiveData)
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redactSensitiveData(value)
      }
    }
    return result
  }
  return obj
}

const HTTP_LOG_FILENAME = `http-req-res-log-${LOG_FILE_TIMESTAMP}.txt`
const HTTP_LOG_PATH = join(LOGS_DIRECTORY, HTTP_LOG_FILENAME)

const PROMPT_KEYWORDS = ['"query"', '"prompt"', '"messages"']

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPromptRequest(url: string, postData: string | null, debug = false): boolean {
  const isPerplexityAiApi = url.includes('/backend-api/chat') || url.includes('/api/v1/chat')
  if (isPerplexityAiApi) return true

  if (postData) {
    const parseResult = from(() => JSON.parse(postData))
    if (parseResult.ok) {
      const validated = PromptPostDataSchema.safeParse(parseResult.value)
      if (validated.success) {
        const hasPromptFields =
          validated.data.query ||
          validated.data.prompt ||
          (validated.data.messages && Array.isArray(validated.data.messages))
        if (hasPromptFields) {
          return true
        }
      } else {
        const writer = new ApiDiagnosticsWriter({ debug })
        const paths = validated.error.issues.map((issue) => issue.path.join('.'))
        writer.writeFailure({
          url,
          errorType: 'zod_error',
          zodErrorPaths: paths,
        })
      }
    }

    const containsPromptKeyword = PROMPT_KEYWORDS.some((keyword) => postData.includes(keyword))
    if (containsPromptKeyword) {
      return true
    }
  }
  return false
}

function ensureLogsDirectoryExists(): void {
  if (!existsSync(LOGS_DIRECTORY)) {
    mkdirSync(LOGS_DIRECTORY, { recursive: true })
  }
}

function redactUrlQuery(url: string): string {
  const urlResult = from(() => new URL(url))
  if (!urlResult.ok) return url
  const urlObj = urlResult.value
  const sensitiveQueryPattern =
    /token|secret|authorization|cookie|password|api[_-]?key|access[_-]?token|bearer/i
  for (const [key] of urlObj.searchParams.entries()) {
    if (sensitiveQueryPattern.test(key)) {
      urlObj.searchParams.set(key, '[REDACTED]')
    }
  }
  return urlObj.toString()
}

export async function logHttpRequest(request: Request, debug: boolean): Promise<void> {
  if (!debug) return

  ensureLogsDirectoryExists()

  const requestUrl = redactUrlQuery(request.url())
  const requestMethod = request.method()
  const redactedHeaders = redactSensitiveData(request.headers())
  const sanitizedHeaders = isPlainObject(redactedHeaders)
    ? (redactedHeaders as Record<string, string>)
    : {}
  const rawPostData = request.postData()

  const requestBody = isPromptRequest(requestUrl, rawPostData, debug)
    ? '[PROMPT REDACTED]'
    : rawPostData

  const logTimestamp = new Date().toISOString()
  const logEntry = [
    `[${logTimestamp}] REQUEST: ${requestMethod} ${requestUrl}`,
    `Headers: ${JSON.stringify(sanitizedHeaders, null, 2)}`,
    `Body: ${requestBody ?? 'None'}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}

export async function logHttpResponse(response: Response, debug: boolean): Promise<void> {
  if (!debug) return

  const originalRequest = response.request()
  const responseUrl = redactUrlQuery(originalRequest.url())
  const responseStatus = response.status()
  const redactedResponseHeaders = redactSensitiveData(response.headers())
  const sanitizedResponseHeaders = isPlainObject(redactedResponseHeaders)
    ? (redactedResponseHeaders as Record<string, string>)
    : {}

  let responseBody = '[BODY SKIPPED]'

  const contentType = sanitizedResponseHeaders['content-type'] ?? ''
  const isJsonContent = contentType.includes('application/json')
  const isPrompt = isPromptRequest(responseUrl, originalRequest.postData(), debug)

  if (isJsonContent && !isPrompt) {
    const jsonResult = await from(async () => await response.json())
    responseBody = jsonResult.ok
      ? JSON.stringify(jsonResult.value, null, 2)
      : '[COULD NOT PARSE JSON BODY]'
  }

  const logTimestamp = new Date().toISOString()
  const logEntry = [
    `[${logTimestamp}] RESPONSE: ${responseStatus} ${responseUrl}`,
    `Headers: ${JSON.stringify(sanitizedResponseHeaders, null, 2)}`,
    `Body: ${responseBody}`,
    '--------------------------------------------------------------------------------',
  ].join('\n')

  appendFileSync(HTTP_LOG_PATH, logEntry + '\n')
}
