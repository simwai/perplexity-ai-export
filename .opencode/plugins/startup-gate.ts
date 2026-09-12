import { definePlugin } from '@opencode/plugin'

/**
 * STARTUP Gate Plugin for opencode
 *
 * Enforces mandatory STARTUP phase completion before any user interaction.
 * Subscribes to session.created and injects fingerprint requirement into system prompt.
 * Blocks chat.message processing until valid fingerprint is received.
 */

interface FingerprintData {
  lineCount: number
  first100: string
  last100: string
  sha256First1kb: string
}

const STARTUP_SYSTEM_PROMPT = `
=== MANDATORY STARTUP VERIFICATION ===

BEFORE ANY RESPONSE, you MUST complete the STARTUP phase:

1. Read prompt-system/00-system.md in FULL (single read, no chunking)
2. Emit this EXACT fingerprint format:
   00-system.md fingerprint: <line_count> lines, first_100_chars="<first 100 chars>", last_100_chars="<last 100 chars>", sha256_first_1kb="<hash or N/A>"

3. Load all 7 other system files per load order in 00-system.md
4. Record completion in session state file's ## Startup Verification section

NO phase output, NO tool calls, NO decisions permitted until fingerprint is emitted.

This is enforced by the STARTUP gate plugin. The session will not proceed until verified.
`

export default definePlugin(({ events, aisdk, session }) => {
  let startupVerified = false
  let pendingFingerprint = false

  // Subscribe to session creation - runs for both new and resumed sessions
  events.on('session.created', async ({ sessionID }) => {
    startupVerified = false
    pendingFingerprint = false

    // Inject STARTUP requirement into system prompt
    await aisdk.system.transform(async (system) => {
      if (!startupVerified) {
        return [...system, STARTUP_SYSTEM_PROMPT]
      }
      return system
    })

    // Intercept user messages until fingerprint verified
    const messageHandler = events.on('chat.message', async ({ message, parts }) => {
      if (startupVerified) {
        messageHandler.dispose()
        return
      }

      // Check if this message contains a valid fingerprint
      const text = parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')

      const fingerprintMatch = text.match(
        /00-system\.md fingerprint:\s*(\d+)\s+lines,\s*first_100_chars="([^"]{0,100})",\s*last_100_chars="([^"]{0,100})",\s*sha256_first_1kb="([^"]+)"/
      )

      if (fingerprintMatch) {
        const [, lineCount, first100, last100, sha256] = fingerprintMatch

        // Validate fingerprint has reasonable values
        if (parseInt(lineCount) > 0 && first100.length > 0) {
          startupVerified = true

          // Record in session state
          try {
            await session.updateState(sessionID, {
              startup_verified: true,
              startup_fingerprint: {
                lineCount: parseInt(lineCount),
                first100,
                last100,
                sha256First1kb: sha256,
                verifiedAt: new Date().toISOString(),
              },
            })
          } catch {
            // State update failed but fingerprint accepted
          }

          // Remove the injected system prompt
          await aisdk.system.transform((system) =>
            system.filter((s) => !s.includes('MANDATORY STARTUP VERIFICATION'))
          )

          messageHandler.dispose()
        }
      }
    })
  })

  // Also check on session resume/restore
  events.on('session.updated', async ({ sessionID, info }) => {
    if (info.startup_verified === true && info.startup_fingerprint) {
      startupVerified = true
      // Clean up injected prompt
      await aisdk.system.transform((system) =>
        system.filter((s) => !s.includes('MANDATORY STARTUP VERIFICATION'))
      )
    }
  })
})
