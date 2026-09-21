import { spawn } from 'node:child_process'

export type ShellResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export function createShell(): (cmd: string, args: string[]) => Promise<ShellResult> {
  return async (cmd: string, args: string[]): Promise<ShellResult> => {
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
      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })
    })
  }
}
