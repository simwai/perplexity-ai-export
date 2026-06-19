import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Request, Response } from 'patchright'
import { errorBus } from './error-bus.js'

const LOGS_DIRECTORY_NAME = 'logs'
const LOG_FILE_TIMESTAMP_SUFFIX = new Date().toISOString().replace(/[:.]/g, '-')
const HTTP_REQUEST_RESPONSE_LOG_FILENAME = `http-request-response-log-${LOG_FILE_TIMESTAMP_SUFFIX}.txt`
const HTTP_LOG_FULL_PATH = join(LOGS_DIRECTORY_NAME, HTTP_REQUEST_RESPONSE_LOG_FILENAME)

const SENSITIVE_HEADER_NAMES = ['authorization', 'cookie', 'set-cookie', 'x-api-key']
const PROMPT_KEYWORD_INDICATORS = ['"query"', '"prompt"', '"messages"']

function redactSensitiveHeaders(headersRecord: Record<string, string>): Record<string, string> {
  const redactedHeaders = { ...headersRecord }
  for (const headerKey of SENSITIVE_HEADER_NAMES) {
    if (redactedHeaders[headerKey]) {
      redactedHeaders[headerKey] = '[REDACTED]'
    }
  }
  return redactedHeaders
}

function isRequestContainingUserPrompts(
  requestUrl: string,
  requestPostData: string | null
): boolean {
  const isChatEndpoint = requestUrl.includes('/chat')
  if (isChatEndpoint) return true

  if (requestPostData) {
    try {
      const parsedPostData = JSON.parse(requestPostData)
      const hasPromptProperties = !!(
        parsedPostData.query ||
        parsedPostData.prompt ||
        (parsedPostData.messages && Array.isArray(parsedPostData.messages))
      )
      if (hasPromptProperties) return true
    } catch {
      return PROMPT_KEYWORD_INDICATORS.some((keyword) => requestPostData.includes(keyword))
    }
  }
  return false
}

export function logHttpRequest(webRequest: Request, isDebugModeEnabled: boolean): void {
  if (!isDebugModeEnabled) return

  try {
    if (!existsSync(LOGS_DIRECTORY_NAME)) {
      mkdirSync(LOGS_DIRECTORY_NAME, { recursive: true })
    }

    const bodyDisplayContent = isRequestContainingUserPrompts(
      webRequest.url(),
      webRequest.postData()
    )
      ? '[PROMPT REDACTED]'
      : webRequest.postData()

    const logEntryText =
      `[${new Date().toISOString()}] REQUEST: ${webRequest.method()} ${webRequest.url()}\n` +
      `Headers: ${JSON.stringify(redactSensitiveHeaders(webRequest.headers()), null, 2)}\n` +
      `Body: ${bodyDisplayContent ?? 'None'}\n` +
      '--------------------------------------------------------------------------------\n'

    appendFileSync(HTTP_LOG_FULL_PATH, logEntryText)
  } catch (loggingError) {
    errorBus.emitError('HTTP Request logging failed', loggingError)
  }
}

export async function logHttpResponse(
  webResponse: Response,
  isDebugModeEnabled: boolean
): Promise<void> {
  if (!isDebugModeEnabled) return

  try {
    const originalRequest = webResponse.request()
    let responseBodyDisplay = '[BODY SKIPPED]'
    const responseContentType = webResponse.headers()['content-type'] ?? ''
    const isJsonContent = responseContentType.includes('json')
    const isRequestAPrompt = isRequestContainingUserPrompts(
      originalRequest.url(),
      originalRequest.postData()
    )

    if (isJsonContent && !isRequestAPrompt) {
      try {
        responseBodyDisplay = JSON.stringify(await webResponse.json(), null, 2)
      } catch {
        responseBodyDisplay = '[PARSE ERROR]'
      }
    }

    const logEntryText =
      `[${new Date().toISOString()}] RESPONSE: ${webResponse.status()} ${webResponse.url()}\n` +
      `Headers: ${JSON.stringify(redactSensitiveHeaders(webResponse.headers()), null, 2)}\n` +
      `Body: ${responseBodyDisplay}\n` +
      '--------------------------------------------------------------------------------\n'

    appendFileSync(HTTP_LOG_FULL_PATH, logEntryText)
  } catch (loggingError) {
    errorBus.emitError('HTTP Response logging failed', loggingError)
  }
}
