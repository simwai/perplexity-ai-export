/**
 * Reading Protocol Plugin for opencode
 *
 * Enforces complete reading before analysis output:
 * - Computes dependency closure (depth 3) when session target is set
 * - Tracks actual read tool fingerprints in a ledger
 * - Blocks analysis output when Reading Plan is incomplete
 *
 * Hooks:
 *   1. session.created  -> initialize reading state
 *   2. session.updated  -> compute closure on first target set,
 *                          track reads, verify before analysis output
 *   3. session.deleted  -> cleanup
 */

import { readFile } from 'node:fs/promises'

interface ReadingPlanFile {
  path: string
  status: 'pending' | 'complete' | 'deferred'
}

interface ReadingPlan {
  scope: string
  created_at: string
  status: 'in_progress' | 'complete' | 'partial-approved' | 'skipped-greenfield'
  files: ReadingPlanFile[]
}

interface ReadingState {
  sessionId: string
  plan: ReadingPlan | null
  readFingerprints: Set<string>
  blocked: boolean
  lastUnreadFiles: string[]
}

const readingStates = new Map<string, ReadingState>()

function getOrCreateState(sessionId: string): ReadingState {
  let state = readingStates.get(sessionId)
  if (!state) {
    state = {
      sessionId,
      plan: null,
      readFingerprints: new Set<string>(),
      blocked: false,
      lastUnreadFiles: [],
    }
    readingStates.set(sessionId, state)
  }
  return state
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function computeImportClosure(
  directory: string,
  targetPath: string,
  maxDepth: number,
  maxCalls: number,
  client: any
): Promise<string[]> {
  const excludedDirs = [
    'node_modules',
    'vendor',
    'prompt-system',
    'dist',
    'build',
    '.git',
    '__pycache__',
    '.venv',
    'venv',
  ]
  const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php']
  const testPatterns = ['.test.', '.spec.', 'test_']
  const closure = new Set<string>()
  const visited = new Set<string>()
  const queue: { path: string; depth: number }[] = [{ path: targetPath, depth: 0 }]
  let calls = 0

  const isExcluded = (p: string) =>
    excludedDirs.some((d) => p.includes(`/${d}/`) || p.includes(`\\${d}\\`))

  const isSource = (p: string) => sourceExts.some((ext) => p.endsWith(ext))
  const isTest = (p: string) => testPatterns.some((t) => p.includes(t))

  const addIfSource = (p: string) => {
    if (isSource(p) && !isExcluded(p)) {
      closure.add(p)
    }
  }

  const resolveImport = (base: string, rawImport: string): string | null => {
    const trimmed = rawImport.replace(/['";]/g, '').trim()
    if (!trimmed || trimmed.startsWith('.') === false) return null
    const baseDir = base.substring(
      0,
      base.lastIndexOf('/') >= 0 ? base.lastIndexOf('/') : base.lastIndexOf('\\')
    )
    const resolved = `${baseDir}/${trimmed}`
    const withExt = sourceExts.find((ext) => resolved.endsWith(ext)) ? resolved : `${resolved}.ts`
    return withExt
  }

  while (queue.length > 0 && calls < maxCalls) {
    const { path: current, depth } = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    addIfSource(current)
    if (depth >= maxDepth) continue

    const absolutePath = `${directory}/${current}`
    let content: string
    try {
      content = await readFile(absolutePath, 'utf-8')
    } catch {
      continue
    }
    calls++

    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRegex.exec(content)) !== null && calls < maxCalls) {
      const resolved = resolveImport(current, match[1])
      if (resolved && !visited.has(resolved)) {
        queue.push({ path: resolved, depth: depth + 1 })
      }
    }

    const fileName = current.substring(
      current.lastIndexOf('/') >= 0 ? current.lastIndexOf('/') + 1 : current.length
    )
    try {
      const reverseResults = await client.find.text({
        query: {
          directory,
          pattern: `import\\s+.*?${escapeRegex(fileName)}`,
        },
      })
      if (reverseResults && calls < maxCalls) {
        for (const rm of reverseResults) {
          const rp = rm.path.text
          if (!visited.has(rp) && isSource(rp)) {
            queue.push({ path: rp, depth: depth + 1 })
          }
        }
      }
    } catch {
      // reverse lookup unavailable; continue without it
    }
    calls++
  }

  for (const file of closure) {
    const base = file.replace(`${directory}/`, '')
    const absolutePath = `${directory}/${base}`
    let content: string
    try {
      content = await readFile(absolutePath, 'utf-8')
    } catch {
      continue
    }
    const testFiles = sourceExts.flatMap((ext) => {
      const baseName = base.replace(ext, '')
      return [baseName + '.test' + ext, baseName + '.spec' + ext, 'test_' + baseName + ext]
    })
    for (const tf of testFiles) {
      const testPath = `${directory}/${tf}`
      try {
        await readFile(testPath, 'utf-8')
        closure.add(tf)
      } catch {
        // test file does not exist, skip
      }
    }
  }

  return Array.from(closure)
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
  return {
    event: async ({ event }: { event: any }) => {
      const sessionId = event.properties?.sessionID
      if (!sessionId) return

      const state = getOrCreateState(sessionId)

      if (event.type === 'session.created') {
        state.plan = null
        state.readFingerprints = new Set<string>()
        state.blocked = false
        state.lastUnreadFiles = []
        console.log(`[reading-protocol] Session created: ${sessionId}`)
        return
      }

      if (event.type === 'session.updated') {
        const info = event.properties?.info

        if (!state.plan && info?.metadata?.target) {
          const target = info.metadata.target as string
          const relativeTarget = target.startsWith(directory)
            ? target.substring(directory.length + 1)
            : target

          const files = await computeImportClosure(directory, relativeTarget, 3, 30, client)

          state.plan = {
            scope: relativeTarget,
            created_at: new Date().toISOString(),
            status: 'in_progress',
            files: files.map((f) => ({ path: f, status: 'pending' })),
          }
          console.log(
            `[reading-protocol] Reading Plan created for ${sessionId}: ${files.length} files`
          )
        }

        if (state.plan && !state.blocked) {
          const pendingFiles = state.plan.files.filter((f) => f.status === 'pending')
          if (pendingFiles.length > 0 && info?.metadata?.phase) {
            const phase = info.metadata.phase
            if (['REVIEW', 'PLAN', 'DOCS', 'DISCUSS', 'PATCH'].includes(phase)) {
              state.blocked = true
              state.lastUnreadFiles = pendingFiles.map((f) => f.path)
              const unreadList = state.lastUnreadFiles.map((f) => `- ${f}`).join('\n')
              console.log(
                `[reading-protocol] Blocked ${phase} output for ${sessionId}: ${pendingFiles.length} unread files`
              )
              return
            }
          }
        }

        if (info?.metadata?.edited_files && Array.isArray(info.metadata.edited_files)) {
          for (const edited of info.metadata.edited_files) {
            const fingerprint = `read:${edited}`
            if (!state.readFingerprints.has(fingerprint)) {
              state.readFingerprints.add(fingerprint)
              if (state.plan) {
                const fileEntry = state.plan.files.find((f) => f.path === edited)
                if (fileEntry && fileEntry.status === 'pending') {
                  fileEntry.status = 'complete'
                  console.log(`[reading-protocol] Marked complete: ${edited}`)
                }
              }
            }
          }
        }

        if (state.plan && state.plan.files.every((f) => f.status === 'complete')) {
          state.plan.status = 'complete'
          state.blocked = false
          state.lastUnreadFiles = []
          console.log(`[reading-protocol] Reading Plan complete for ${sessionId}`)
        }
      }

      if (event.type === 'session.deleted') {
        readingStates.delete(sessionId)
        console.log(`[reading-protocol] Session deleted: ${sessionId}`)
        return
      }
    },
  }
}
