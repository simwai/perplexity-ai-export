import { IS_BUN, BUN } from '../detect.js'
import { isRecord } from '../../core/result.js'

export type SpawnResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type BunProc = {
  exited: Promise<number | undefined>
  stdout: unknown
  stderr: unknown
}

function bunSpawn(cmd: string, args: string[]): BunProc | null {
  if (!IS_BUN || !isRecord(BUN)) return null
  const spawn = BUN['spawn']
  if (typeof spawn !== 'function') return null
  const proc: unknown = spawn({ cmd: [cmd, ...args], stdout: 'pipe', stderr: 'pipe' })
  if (!isRecord(proc)) return null
  if (!('exited' in proc)) return null
  return proc as BunProc
}

async function streamText(stream: unknown): Promise<string> {
  if (!isRecord(stream) || typeof stream['getReader'] !== 'function') return ''
  const reader: unknown = stream['getReader']()
  if (!isRecord(reader) || typeof reader['read'] !== 'function') return ''
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const chunk: unknown = await reader['read']()
    if (!isRecord(chunk) || chunk['done'] === true) break
    const value = chunk['value']
    if (value instanceof Uint8Array) out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

export async function spawnCommand(cmd: string, args: string[]): Promise<SpawnResult> {
  const bun = bunSpawn(cmd, args)
  if (bun) {
    const [exitCode, stdout, stderr] = await Promise.all([
      bun.exited,
      streamText(bun.stdout),
      streamText(bun.stderr),
    ])
    return { exitCode: exitCode ?? 1, stdout, stderr }
  }
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', (code: number | null) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}
