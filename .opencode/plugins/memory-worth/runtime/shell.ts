import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isRecord } from '../core/result.js'
import { spawnCommand } from './shim/spawn-shim.js'

const execFileAsync = promisify(execFile)

type BunShell = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>

// Every command execution in the plugin goes through this helper. Never call
// ctx.$ directly: the Bun path runs only when a function is present, and the
// Node fallback passes argv without a shell, so no quoting layer exists.
export async function runCommand(ctx: unknown, cmd: string, args: string[]): Promise<string> {
  if (isRecord(ctx) && typeof ctx['$'] === 'function') {
    const shell = ctx['$'] as BunShell
    const result: unknown = await shell`${cmd} ${args}`
    if (isRecord(result) && typeof result['stdout'] === 'string') return result['stdout']
    if (typeof result === 'string') return result
    return JSON.stringify(result) ?? ''
  }
  const { stdout } = await execFileAsync(cmd, args, { windowsHide: true })
  return stdout
}

export async function runCommandPortable(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await spawnCommand(cmd, args)
  return stdout
}
