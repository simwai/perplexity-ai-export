/**
 * Baba Goal Detection Plugin for opencode
 *
 * Watches the first user message in a session. If the message looks like a
 * free-text goal (no concrete target) AND the user has not already invoked a
 * command, surfaces a one-time suggestion to run /kickoff.
 *
 * Heuristics (conservative — one false positive per session max, dismissible):
 *   Goal-like:   contains action verbs (build|create|implement|add|make|develop|set up|write)
 *                AND a noun phrase after the verb
 *   Not a goal:  mentions a file path (./, src/, @, .ts, .py, .md), a bug report
 *                (bug, fix, broken, error, crash), a line number, or starts with
 *                a slash command (already explicit)
 */

const GOAL_VERB =
  /\b(build|create|implement|implementing|add|make|develop|set\s+up|write|ship|ship a|scaffold|introduce|integrate)\b/i
const TARGET_HINTS =
  /(\.[a-z]{1,4}\b|^\s*\/|@|line\s+\d|l\d+\b|src\/|app\/|lib\/|\/[a-z-]+\.[a-z])/i
const BUG_HINTS =
  /\b(bug|fix|broken|error|crash|fail|fails|regression|hotfix|stack trace|exception)\b/i
const QUESTION_ONLY = /^(how|what|why|when|where|can you explain|is there)\b/i

interface SessionGoalState {
  assessed: boolean
  suggested: boolean
}

const sessionStates = new Map<string, SessionGoalState>()

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
      if (event.type !== 'session.updated') return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      let state = sessionStates.get(sessionID)
      if (!state) {
        state = { assessed: false, suggested: false }
        sessionStates.set(sessionID, state)
      }
      if (state.assessed) return

      const info = event.properties?.info
      const messages = info?.messages || event.properties?.messages
      if (!Array.isArray(messages) || messages.length === 0) return

      // Find the first user-authored message
      const firstUser = messages.find((m: any) => m?.role === 'user')
      if (!firstUser || typeof firstUser.content !== 'string') return

      const text = firstUser.content.trim()

      // Never twice
      state.assessed = true
      sessionStates.set(sessionID, state)

      // Skip heuristics
      if (text.startsWith('/')) return // already a command
      if (TARGET_HINTS.test(text)) return // concrete target
      if (BUG_HINTS.test(text)) return // bug report
      if (QUESTION_ONLY.test(text)) return // question / exploration
      if (!GOAL_VERB.test(text)) return // no goal verb
      if (text.length < 40) return // too short to be a goal

      try {
        await $`opencode tui toast show --title "Baba PM" --message "Goal detected — run /kickoff to bootstrap roadmap, sprint, stories, and ICE scores" --variant info`
      } catch (e) {
        console.log('[baba-goal-detect] toast failed:', e)
      }

      try {
        await client.message.create({
          sessionID,
          role: 'system',
          content: `Goal-like first message detected. Suggested next step: run /kickoff with the goal text to bootstrap roadmap → sprint → stories → ICE scores → task card in one consolidated flow. If this is already a concrete target, ignore this note.`,
        })
      } catch (e) {
        console.log('[baba-goal-detect] message.create failed:', e)
      }

      state.suggested = true
      sessionStates.set(sessionID, state)
    },
  }
}
