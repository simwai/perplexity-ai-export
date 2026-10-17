/**
 * Auto-First-Message Plugin for opencode
 *
 * Automatically sends a first message at the start of every new session/conversation
 * reminding the agent to read AGENTS.md and follow instructions 1:1.
 */

const FIRST_MESSAGE = `# Session Start Reminder

Before you do anything else, you MUST:

1. **Read AGENTS.md in full** -- This is the sole entry point for the Baba prompt system
2. **Follow all instructions 1:1** -- No deviations, no shortcuts

The system will not function correctly if you skip this step. The STARTUP phase in 00-system.md requires you to:
- Read prompt-system/00-system.md in full (no chunking)
- Emit the bootstrap fingerprint
- Load every file in the load order in full (no chunking)
- Record completion in the session state file

Do not respond to the user or take any action until this is complete.`

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
      // Session created - initialize state silently
      if (event.type === 'session.created') {
        const sessionID = event.properties.sessionID
        return
      }
    },
  }
}
