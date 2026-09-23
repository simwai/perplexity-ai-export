import { delimiter, isAbsolute, join } from 'node:path'
import { statSync } from 'node:fs'
import { IS_BUN, BUN } from '../detect.js'
import { isRecord } from '../../core/result.js'

export function which(cmd: string): string | null {
  if (IS_BUN && isRecord(BUN) && typeof BUN['which'] === 'function') {
    const found: unknown = BUN['which'](cmd)
    return typeof found === 'string' && found.length > 0 ? found : null
  }
  return walkPath(cmd)
}

function walkPath(cmd: string): string | null {
  if (isAbsolute(cmd)) return existsFile(cmd) ? cmd : null
  const pathValue = globalThis.process?.env?.['PATH']
  if (typeof pathValue !== 'string' || pathValue.length === 0) return null
  const extensions =
    globalThis.process?.platform === 'win32'
      ? (globalThis.process?.env?.['PATHEXT'] ?? '.EXE').split(';')
      : ['']
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    for (const ext of extensions) {
      const candidate = join(dir, cmd + ext.toLowerCase())
      if (existsFile(candidate)) return candidate
    }
  }
  return null
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
