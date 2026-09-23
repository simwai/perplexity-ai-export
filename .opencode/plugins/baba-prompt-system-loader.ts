/**
 * Prompt System Loader Plugin for opencode
 *
 * Tracks which prompt-system/*.md files have been loaded this session
 * and injects a system reminder when the full set has not been read
 * before entering a new phase.
 *
 * The required file set is discovered from the filesystem at session
 * creation time -- no hardcoded list, no drift.
 */

interface LoaderState {
  requiredFiles: Set<string>
  loadedFiles: Set<string>
  lastNotifiedPhase: string
  planVersion: number // 1 = initial, 2 = post-reload after PLAN v1 approval
}

const loaderStates = new Map<string, LoaderState>()

function relativePromptSystemPath(absPath: string, directory: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  const root = directory.replace(/\\/g, '/')
  if (normalized.startsWith(root + '/')) {
    return normalized.slice(root.length + 1)
  }
  return normalized
}

async function discoverRequiredFiles(client: any, directory: string): Promise<Set<string>> {
  const files = new Set<string>()
  try {
    const results = await client.find.files({
      query: { query: 'prompt-system/*.md', type: 'file' },
    })
    for (const absPath of results) {
      const rel = relativePromptSystemPath(absPath, directory)
      if (rel.startsWith('prompt-system/')) {
        files.add(rel)
      }
    }
  } catch {
    // filesystem discovery unavailable; fall back to empty set
    // enforcement becomes advisory-only for this session
  }
  return files
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

      if (event.type === 'session.created') {
        const required = await discoverRequiredFiles(client, directory)
        loaderStates.set(sessionId, {
          requiredFiles: required,
          loadedFiles: new Set(),
          lastNotifiedPhase: 'STARTUP',
          planVersion: 1,
        })
        return
      }

      if (event.type === 'session.deleted') {
        loaderStates.delete(sessionId)
        return
      }
    },

    'tool.execute.after': async (input: {
      tool: string
      sessionID: string
      callID: string
      args: any
    }) => {
      const sessionId = input.sessionID
      if (!sessionId) return

      const state = loaderStates.get(sessionId)
      if (!state || state.requiredFiles.size === 0) return

      if (input.tool === 'read' && input.args?.filePath) {
        const rel = relativePromptSystemPath(input.args.filePath, directory)
        if (state.requiredFiles.has(rel)) {
          state.loadedFiles.add(rel)
        }
      }
    },

    'experimental.chat.messages.transform': async (input: any, output: { messages: any[] }) => {
      const sessionId = input.sessionID ?? input.session_id
      if (!sessionId) return

      const state = loaderStates.get(sessionId)
      if (!state || state.requiredFiles.size === 0) return

      const messages = output.messages
      if (!messages || messages.length === 0) return

      const lastMessage = messages[messages.length - 1]
      if (!lastMessage.parts) return

      let detectedPhase: string | undefined
      for (const part of lastMessage.parts) {
        if (part.type !== 'text' || !part.text) continue
        const match = part.text.match(/^\[PHASE:\s*([A-Z_]+)\]/m)
        if (match) {
          detectedPhase = match[1]
          break
        }
      }

      if (!detectedPhase || detectedPhase === state.lastNotifiedPhase) return

      // PLAN v1 → v2 transition: force full reload after PLAN v1 approval
      if (detectedPhase === 'PLAN' && state.planVersion === 1) {
        state.planVersion = 2
        state.loadedFiles.clear() // Forces full reload on next reads
        console.log('[prompt-system-loader] PLAN v1→v2: forcing full reload')
      }

      const missing = [...state.requiredFiles].filter((f) => !state.loadedFiles.has(f))

      if (missing.length > 0) {
        const list = missing.map((f) => `- ${f}`).join('\n')
        const content =
          `PROMPT SYSTEM LOADER: The full prompt system has not been loaded this session.\n` +
          `Missing files:\n${list}\n` +
          `Read them before producing ${detectedPhase} output.`

        console.log(`[prompt-system-loader] Missing files for ${detectedPhase}:\n${list}`)
      }

      state.lastNotifiedPhase = detectedPhase
    },
  }
}
