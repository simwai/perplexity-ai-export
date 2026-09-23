/**
 * Lock Enforcement Plugin for opencode
 *
 * Prevents file edits without a valid session lock.
 * Intercepts file write operations and blocks them unless the session
 * holds a valid lock (per-file or dependency lock) for the target file.
 *
 * Uses the existing session-locks.ps1 PowerShell script for lock verification.
 * Inert on READ_ONLY hosts (BABA_READ_ONLY=1).
 */

import { type Plugin, tool } from '@opencode-ai/plugin'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

interface LockCheckResult {
  held: boolean
  owner?: string
  type?: 'PerFile' | 'Dependency'
  reason?: string
  error?: string
}

interface LockState {
  sessionId: string
  repoRoot: string
  isReadOnlyHost: boolean
}

const lockStates = new Map<string, LockState>()

function getOrCreateLockState(sessionId: string, directory: string): LockState {
  let state = lockStates.get(sessionId)
  if (!state) {
    state = {
      sessionId,
      repoRoot: directory,
      isReadOnlyHost: process.env.BABA_READ_ONLY === '1' || process.env.BABA_READ_ONLY === 'true',
    }
    lockStates.set(sessionId, state)
  }
  return state
}

function extractFilePath(toolName: string, args: any): string | null {
  switch (toolName) {
    case 'write':
    case 'edit':
    case 'patch':
      return args?.filePath || args?.path || null
    default:
      return null
  }
}

function toRepoRelative(absolutePath: string, repoRoot: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const rootNormalized = repoRoot.replace(/\\/g, '/')
  if (normalized.startsWith(rootNormalized)) {
    return normalized.substring(rootNormalized.length + 1)
  }
  return normalized
}

async function checkFileLock(
  repoRoot: string,
  sessionId: string,
  filePath: string
): Promise<LockCheckResult> {
  const scriptPath = resolve(repoRoot, 'prompt-system/scripts/session-locks.ps1')
  const relativePath = toRepoRelative(filePath, repoRoot)

  return new Promise((resolve) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Command',
        'Test-FileLockHeld',
        '-RepoRelativePath',
        relativePath,
        '-SessionId',
        sessionId,
      ],
      {
        cwd: repoRoot,
        windowsHide: true,
      }
    )

    let stdout = ''
    let stderr = ''

    ps.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    ps.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ps.on('close', (code) => {
      if (code !== 0) {
        try {
          const result = JSON.parse(stdout.trim())
          resolve(result)
        } catch {
          resolve({ held: false, error: `Lock check failed (exit ${code}): ${stderr || stdout}` })
        }
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        resolve(result)
      } catch {
        resolve({ held: false, error: 'Failed to parse lock check output' })
      }
    })

    ps.on('error', (err) => {
      resolve({ held: false, error: `Failed to spawn lock check: ${err.message}` })
    })

    setTimeout(() => {
      ps.kill('SIGTERM')
      resolve({ held: false, error: 'Lock check timed out' })
    }, 10000)
  })
}

async function acquireFileLock(
  repoRoot: string,
  sessionId: string,
  filePath: string
): Promise<any> {
  const scriptPath = resolve(repoRoot, 'prompt-system/scripts/session-locks.ps1')
  const relativePath = toRepoRelative(filePath, repoRoot)

  return new Promise((resolve) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Command',
        'Acquire-FileLock',
        '-RepoRelativePath',
        relativePath,
        '-SessionId',
        sessionId,
      ],
      {
        cwd: repoRoot,
        windowsHide: true,
      }
    )

    let stdout = ''
    let stderr = ''

    ps.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    ps.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ps.on('close', (code) => {
      if (code !== 0) {
        try {
          const result = JSON.parse(stdout.trim())
          resolve(result)
        } catch {
          resolve({ Success: false, error: `Acquire failed (exit ${code}): ${stderr || stdout}` })
        }
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        resolve(result)
      } catch {
        resolve({ Success: false, error: 'Failed to parse acquire output' })
      }
    })

    ps.on('error', (err) => {
      resolve({ Success: false, error: `Failed to spawn acquire: ${err.message}` })
    })

    setTimeout(() => {
      ps.kill('SIGTERM')
      resolve({ Success: false, error: 'Acquire timed out' })
    }, 15000)
  })
}

export default async ({
  client,
  $,
  project,
  directory,
  worktree,
}: {
  client: any
  $: any
  project: any
  directory: string
  worktree: string
}) => {
  const writeTools = new Set(['write', 'edit', 'patch'])

  return {
    'tool.execute.before': async (input: { tool: string; args: any }, output: { args: any }) => {
      const { tool, args } = input

      if (!writeTools.has(tool)) return

      const sessionId = args?.sessionID || args?.session_id
      if (!sessionId) return

      const state = getOrCreateLockState(sessionId, directory)

      if (state.isReadOnlyHost) return

      const filePath = extractFilePath(tool, args)
      if (!filePath) return

      const lockResult = await checkFileLock(state.repoRoot, sessionId, filePath)

      if (lockResult.error) {
        console.warn(`[lock-enforce] Lock check failed for ${filePath}: ${lockResult.error}`)
        return
      }

      if (!lockResult.held) {
        const reason = lockResult.reason || 'No lock held'
        const ownerInfo = lockResult.owner ? ` (held by: ${lockResult.owner})` : ''
        const typeInfo = lockResult.type ? ` [${lockResult.type}]` : ''

        const errorMessage =
          `[LOCK ENFORCEMENT] Write blocked: No valid lock for file "${filePath}".\n` +
          `Reason: ${reason}${ownerInfo}${typeInfo}\n` +
          `You must acquire a lock before editing. Use the \`acquire_lock\` tool:\n` +
          `  acquire_lock({ filePath: "${filePath}" })`

        output.args = { ...args, _lockEnforceBlocked: true, _lockEnforceError: errorMessage }
        throw new Error(errorMessage)
      }

      console.log(`[lock-enforce] Lock verified for ${filePath} (${lockResult.type || 'PerFile'})`)
    },

    tool: {
      acquire_lock: tool({
        description:
          'Acquire a session file lock for a file before editing. Required by the lock enforcement plugin. ' +
          'Call this before any write/edit/patch operation on a file.',
        args: {
          filePath: tool.schema
            .string()
            .describe('Absolute or repo-relative path to the file to lock'),
          lockType: tool.schema
            .string()
            .optional()
            .describe(
              "Type of lock: 'file' (per-file) or 'dependency' (covers dependency graph). Default: 'file'"
            )
            .enum(['file', 'dependency']),
        },
        async execute(args, context) {
          const { sessionID } = context
          if (!sessionID) {
            return 'Error: session ID required'
          }

          const state = getOrCreateLockState(sessionID, directory)

          if (state.isReadOnlyHost) {
            return 'Lock acquisition skipped: READ_ONLY host'
          }

          const result = await acquireFileLock(state.repoRoot, sessionID, args.filePath)

          if (result.Success) {
            const lockType = result.Dependencies ? 'Dependency' : 'PerFile'
            return `Lock acquired: ${args.filePath} [${lockType}] (${result.FlatName})`
          } else {
            const blocked = result.Blocked ? ' (blocked)' : ''
            const owner = result.Owner ? ` by ${result.Owner}` : ''
            const decision = result.Decision ? `\nOptions: ${result.Decision.join(', ')}` : ''
            return `Failed to acquire lock for ${args.filePath}${blocked}${owner}${decision}`
          }
        },
      }),

      release_lock: tool({
        description:
          'Release a session file lock after editing is complete. ' +
          "Call this when you're done editing a file to release the lock.",
        args: {
          filePath: tool.schema
            .string()
            .describe('Absolute or repo-relative path to the file to unlock'),
          lockType: tool.schema
            .string()
            .optional()
            .describe("Type of lock to release: 'file' or 'dependency'. Default: 'file'")
            .enum(['file', 'dependency']),
        },
        async execute(args, context) {
          const { sessionID } = context
          if (!sessionID) {
            return 'Error: session ID required'
          }

          const state = getOrCreateLockState(sessionID, directory)

          if (state.isReadOnlyHost) {
            return 'Lock release skipped: READ_ONLY host'
          }

          const scriptPath = resolve(state.repoRoot, 'prompt-system/scripts/session-locks.ps1')
          const relativePath = toRepoRelative(args.filePath, state.repoRoot)
          const command =
            args.lockType === 'dependency' ? 'Release-DependencyLock' : 'Release-FileLock'

          return new Promise((resolve) => {
            const ps = spawn(
              'powershell',
              [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                scriptPath,
                '-Command',
                command,
                '-RepoRelativePath',
                relativePath,
                '-SessionId',
                sessionID,
              ],
              {
                cwd: state.repoRoot,
                windowsHide: true,
              }
            )

            let stdout = ''
            let stderr = ''

            ps.stdout.on('data', (data) => {
              stdout += data.toString()
            })
            ps.stderr.on('data', (data) => {
              stderr += data.toString()
            })

            ps.on('close', (code) => {
              if (code !== 0) {
                try {
                  const result = JSON.parse(stdout.trim())
                  resolve(result)
                } catch {
                  resolve(`Release failed (exit ${code}): ${stderr || stdout}`)
                }
                return
              }

              try {
                const result = JSON.parse(stdout.trim())
                if (result.Success) {
                  resolve(`Lock released: ${args.filePath}`)
                } else {
                  resolve(`Failed to release lock: ${result.Reason || 'Unknown error'}`)
                }
              } catch {
                resolve('Failed to parse release output')
              }
            })

            ps.on('error', (err) => {
              resolve(`Failed to spawn release: ${err.message}`)
            })

            setTimeout(() => {
              ps.kill('SIGTERM')
              resolve('Release timed out')
            }, 10000)
          })
        },
      }),

      check_lock: tool({
        description: 'Check if the current session holds a lock for a file without acquiring one.',
        args: {
          filePath: tool.schema
            .string()
            .describe('Absolute or repo-relative path to the file to check'),
        },
        async execute(args, context) {
          const { sessionID } = context
          if (!sessionID) {
            return 'Error: session ID required'
          }

          const state = getOrCreateLockState(sessionID, directory)

          if (state.isReadOnlyHost) {
            return 'Lock check skipped: READ_ONLY host'
          }

          const result = await checkFileLock(state.repoRoot, sessionID, args.filePath)

          if (result.error) {
            return `Lock check error: ${result.error}`
          }

          if (result.held) {
            return `Lock HELD for ${args.filePath} [${result.type || 'PerFile'}] (owner: ${result.owner})`
          } else {
            return `Lock NOT HELD for ${args.filePath}. Reason: ${result.reason || 'No lock exists'}${result.owner ? ` (held by: ${result.owner})` : ''}`
          }
        },
      }),
    },

    event: async ({ event }: { event: any }) => {
      if (event.type === 'session.deleted') {
        const sessionId = event.properties?.sessionID
        if (sessionId) {
          lockStates.delete(sessionId)
        }
      }
    },
  }
}
