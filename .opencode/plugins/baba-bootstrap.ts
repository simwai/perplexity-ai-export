/**
 * Auto-First-Message Plugin for opencode
 *
 * Automatically sends a first message at the start of every new session/conversation
 * reminding the agent to read AGENTS.md and BOOTSTRAP.md and follow instructions 1:1.
 */

const FIRST_MESSAGE = `# Session Start Reminder

Before you do anything else, you MUST:

1. **Read AGENTS.md in full** — This is the sole entry point for the Baba prompt system
2. **Read BOOTSTRAP.md in full** — Contains deployment and setup instructions
3. **Follow all instructions 1:1** — No deviations, no shortcuts

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
      // Session created - send initial reminder message
      if (event.type === 'session.created') {
        const sessionID = event.properties.sessionID

        try {
          // Use the client to send a system message at the start of the session
          // This adds a message to the conversation that the agent will see
          await client.message.create({
            sessionID,
            role: 'system',
            content: FIRST_MESSAGE,
          })

          console.log(`[auto-first-message] Sent initial reminder to session ${sessionID}`)
        } catch (error) {
          console.error(`[auto-first-message] Failed to send initial message:`, error)

          // Fallback: show a toast if message creation fails
          try {
            await $`opencode tui toast show --title "Read AGENTS.md & BOOTSTRAP.md First" --message "Follow all instructions 1:1 before responding" --variant warning`
          } catch (toastError) {
            console.error(`[auto-first-message] Toast fallback also failed:`, toastError)
          }
        }
        return
      }
    },
  }
}
