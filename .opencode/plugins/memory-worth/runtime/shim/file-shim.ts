import { IS_BUN, BUN } from '../detect.js'
import { isRecord } from '../../core/result.js'

type BunFile = { text(): Promise<string> }

function bunFile(path: string): BunFile | null {
  if (!IS_BUN || !isRecord(BUN)) return null
  const file = BUN['file']
  if (typeof file !== 'function') return null
  const handle: unknown = file(path)
  if (!isRecord(handle) || typeof handle['text'] !== 'function') return null
  return handle as BunFile
}

function bunWrite(path: string, content: string): Promise<unknown> | null {
  if (!IS_BUN || !isRecord(BUN)) return null
  const write = BUN['write']
  if (typeof write !== 'function') return null
  const result: unknown = write(path, content)
  return result as Promise<unknown>
}

export async function readText(path: string): Promise<string> {
  const handle = bunFile(path)
  if (handle) return handle.text()
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf-8')
}

export async function writeText(path: string, content: string): Promise<void> {
  const pending = bunWrite(path, content)
  if (pending) {
    await pending
    return
  }
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}
