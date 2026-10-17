import { type Plugin, tool } from '@opencode-ai/plugin'

type GenerationConfig = {
  temperature: number
  topP: number
}

type FeedbackConfig = {
  min: GenerationConfig
  max: GenerationConfig
  default: GenerationConfig
}

type SessionState = {
  temperature: number
  topP: number
}

type ApplyFeedbackArgs = {
  temperatureDelta: number
  topPDelta: number
  reasoning: string
}

const sessionStates = new Map<string, SessionState>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function resolveConfig(options: Record<string, unknown>): FeedbackConfig {
  return {
    min: {
      temperature: typeof options.minTemperature === 'number' ? options.minTemperature : 0.0,
      topP: typeof options.minTopP === 'number' ? options.minTopP : 0.1,
    },
    max: {
      temperature: typeof options.maxTemperature === 'number' ? options.maxTemperature : 1.0,
      topP: typeof options.maxTopP === 'number' ? options.maxTopP : 1.0,
    },
    default: {
      temperature:
        typeof options.defaultTemperature === 'number' ? options.defaultTemperature : 0.2,
      topP: typeof options.defaultTopP === 'number' ? options.defaultTopP : 0.9,
    },
  }
}

function getSessionState(sessionID: string, config: FeedbackConfig): SessionState {
  const existing = sessionStates.get(sessionID)
  if (existing) return existing
  const initial: SessionState = {
    temperature: config.default.temperature,
    topP: config.default.topP,
  }
  sessionStates.set(sessionID, initial)
  return initial
}

export default async (_ctx: any, options?: Record<string, unknown>): Promise<any> => {
  const config = resolveConfig(options ?? {})

  return {
    tool: {
      apply_feedback: tool({
        description:
          'Apply generation parameter adjustments based on user feedback. Call this when the user gives feedback about output quality, style, or behavior.',
        args: {
          temperatureDelta: tool.schema
            .number()
            .describe(
              'Delta to apply to temperature (-1.0 to 1.0). Positive increases randomness, negative decreases it.'
            ),
          topPDelta: tool.schema
            .number()
            .describe(
              'Delta to apply to topP (-1.0 to 1.0). Positive increases token diversity, negative narrows focus.'
            ),
          reasoning: tool.schema
            .string()
            .describe('Brief explanation of why these adjustments address the feedback.'),
        },
        async execute(args, context) {
          const { sessionID } = context
          if (!sessionID) {
            return 'Error: session ID required'
          }

          const state = getSessionState(sessionID, config)
          const prevTemperature = state.temperature
          const prevTopP = state.topP

          state.temperature = clamp(
            state.temperature + args.temperatureDelta,
            config.min.temperature,
            config.max.temperature
          )
          state.topP = clamp(state.topP + args.topPDelta, config.min.topP, config.max.topP)

          try {
            await _ctx.client.app.log({
              body: {
                service: 'adaptive-temperature',
                level: 'info',
                message: `Session ${sessionID}: ${args.reasoning} | temperature=${prevTemperature}->${state.temperature}, topP=${prevTopP}->${state.topP}`,
              },
            })
          } catch {
            // logging may not be available
          }

          return `Applied feedback: temperature ${prevTemperature.toFixed(2)} -> ${state.temperature.toFixed(2)}, topP ${prevTopP.toFixed(2)} -> ${state.topP.toFixed(2)}`
        },
      }),
    },

    'command.execute.before': async (input: {
      command: string
      sessionID?: string
      arguments?: string
    }) => {
      const { command, sessionID, arguments: args } = input
      if (!sessionID || command !== 'feedback') return

      const feedbackText = (args ?? '').trim()
      if (!feedbackText) return

      const state = getSessionState(sessionID, config)

      const contextPrompt = `[ADAPTIVE FEEDBACK]\nUser feedback: "${feedbackText}"\nCurrent settings: temperature=${state.temperature.toFixed(2)}, topP=${state.topP.toFixed(2)}\n\nInterpret this feedback and call \`apply_feedback\` with appropriate deltas for temperature and topP, plus a brief reasoning. Consider how the current settings relate to the feedback when choosing deltas.`
    },

    'experimental.chat.system.transform': async (
      { sessionID, model }: { sessionID?: string; model?: any },
      { system }: { system: string[] }
    ) => {
      if (!sessionID) return

      const state = sessionStates.get(sessionID)
      const currentSettings = state
        ? `temperature=${state.temperature.toFixed(2)}, topP=${state.topP.toFixed(2)}`
        : `temperature=${config.default.temperature.toFixed(2)}, topP=${config.default.topP.toFixed(2)}`

      system.push(
        'ADAPTIVE FEEDBACK: When the user gives feedback about output quality, style, or behavior, call the `apply_feedback` tool with temperatureDelta, topPDelta, and reasoning. ' +
          `Current settings: ${currentSettings}. ` +
          'Interpret the feedback relative to current settings and return small, bounded deltas. ' +
          "Example feedback -> adjustment: 'too random' -> temperatureDelta=-0.1, topPDelta=-0.05; 'too boring' -> temperatureDelta=0.1, topPDelta=0.05; 'too narrow' -> temperatureDelta=0.0, topPDelta=0.1; 'too verbose' -> temperatureDelta=-0.05, topPDelta=0.0."
      )
    },

    event: async ({ event }: { event: any }) => {
      if (event.type === 'session.deleted') {
        const sessionID = (event as any).properties?.sessionID
        if (sessionID) {
          sessionStates.delete(sessionID)
        }
      }
    },
  }
}
