/**
 * baba-subtask.ts
 *
 * Node.js-native port of subtask2 core for OpenCode.
 * Registers `/subtask`, intercepts command execution for inline persona
 * delegation, and rewires subtask execution to the registered Baba agents.
 *
 * This plugin replaces Bun-only APIs with Node.js built-ins and keeps the
 * essential subtask2 hooks: config, command.execute.before,
 * tool.execute.before/after, experimental.chat.messages.transform, event.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tool, type PluginInput, type Hooks, type Config } from '@opencode-ai/plugin'
import type { Part, Message, Event, Model } from '@opencode-ai/sdk'

// ============================================================================
// Types
// ============================================================================

interface SubtaskConfig {
  return: string[]
  parallel: string[]
  agent?: string
  description?: string
  template?: string
  loop?: { max: number; until: string }
  model?: string
  auto?: boolean
}

interface InlineSubtask {
  prompt: string
  overrides: {
    agent?: string
    model?: string
    loop?: { max: number; until: string }
    auto?: boolean
    return?: string[]
    parallel?: string[]
    as?: string
  }
}

interface LoopState {
  max: number
  until: string
  current: number
  cmd: string
  args: string
  modelOverride?: { providerID: string; modelID: string }
  agentOverride?: string
}

// ============================================================================
// State
// ============================================================================

let client: any = null
let pluginConfig = { replace_generic: true }

const configs = new Map<string, SubtaskConfig>()
const pendingReturns = new Map<string, string[]>()
const pendingNonSubtaskReturns = new Map<string, string[]>()
const pipedArgsQueue = new Map<string, string[]>()
const sessionMainCommand = new Map<string, string>()
const loopState = new Map<string, LoopState>()
const pendingModelOverride = new Map<string, { providerID: string; modelID: string }>()
const pendingAgentOverride = new Map<string, string>()
const pendingParentByPrompt = new Map<string, string>()
const pendingResultCaptureByPrompt = new Map<string, { parentSessionID: string; name: string }>()
const subtaskResults = new Map<string, Map<string, unknown>>()
const pendingStackedPromptResponse = new Set<string>()
const pendingPromptReturn = new Map<string, string>()

const BABA_AGENTS = [
  'baba-sensei',
  'baba-dev',
  'baba-tester',
  'baba-reviewer',
  'baba-scrum',
  'baba-designer',
  'explore',
  'general',
]

// ============================================================================
// Helpers
// ============================================================================

function log(...args: unknown[]) {
  console.log('[baba-subtask]', ...args)
}

function setClient(newClient: any) {
  client = newClient
}

function setPendingReturn(sessionID: string, returns: string[]) {
  pendingReturns.set(sessionID, returns)
}

function setPendingNonSubtaskReturns(sessionID: string, returns: string[]) {
  pendingNonSubtaskReturns.set(sessionID, returns)
}

function setPipedArgsQueue(sessionID: string, args: string[]) {
  pipedArgsQueue.set(sessionID, args)
}

function setSessionMainCommand(sessionID: string, cmd: string) {
  sessionMainCommand.set(sessionID, cmd)
}

function startLoop(
  sessionID: string,
  loopConfig: { max: number; until: string },
  cmd: string,
  args: string,
  modelOverride?: { providerID: string; modelID: string },
  agentOverride?: string
) {
  loopState.set(sessionID, {
    max: loopConfig.max,
    until: loopConfig.until,
    current: 0,
    cmd,
    args,
    modelOverride,
    agentOverride,
  })
}

function getLoopState(sessionID: string): LoopState | undefined {
  return loopState.get(sessionID)
}

function clearLoopState(sessionID: string) {
  loopState.delete(sessionID)
}

function getPendingModelOverride(sessionID: string) {
  return pendingModelOverride.get(sessionID)
}

function deletePendingModelOverride(sessionID: string) {
  pendingModelOverride.delete(sessionID)
}

function getPendingAgentOverride(sessionID: string): string | undefined {
  return pendingAgentOverride.get(sessionID)
}

function deletePendingAgentOverride(sessionID: string) {
  pendingAgentOverride.delete(sessionID)
}

function registerPendingParentForPrompt(prompt: string, parentSessionID: string) {
  pendingParentByPrompt.set(prompt, parentSessionID)
}

function registerPendingResultCaptureByPrompt(
  prompt: string,
  parentSessionID: string,
  name: string
) {
  pendingResultCaptureByPrompt.set(prompt, { parentSessionID, name })
}

function hasPendingStackedPromptResponse(sessionID: string): boolean {
  return pendingStackedPromptResponse.has(sessionID)
}

function clearPendingStackedPromptResponse(sessionID: string) {
  pendingStackedPromptResponse.delete(sessionID)
}

function consumePendingPromptReturn(sessionID: string): string | undefined {
  const prompt = pendingPromptReturn.get(sessionID)
  if (prompt) {
    pendingPromptReturn.delete(sessionID)
  }
  return prompt
}

// ============================================================================
// Command discovery
// ============================================================================

async function discoverCommands(directory: string): Promise<SubtaskConfig[]> {
  const results: SubtaskConfig[] = []
  try {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }
      const fullPath = join(entry.parentPath ?? directory, entry.name)
      const content = await readFile(fullPath, 'utf-8')
      const config = parseCommandFile(entry.name.replace(/\.md$/, ''), content)
      if (config) {
        results.push(config)
      }
    }
  } catch {
    // Directory may not exist; ignore.
  }
  return results
}

function parseCommandFile(name: string, content: string): SubtaskConfig | null {
  const fm = parseFrontmatter(content)
  if (!fm && name !== 'subtask') {
    return null
  }

  const returnVal = fm?.return
  const returnArr = Array.isArray(returnVal)
    ? returnVal
    : typeof returnVal === 'string'
      ? [returnVal]
      : []

  const parallelArr = parseParallelConfig(fm?.parallel)

  return {
    return: returnArr,
    parallel: parallelArr,
    agent: fm?.agent as string | undefined,
    description: fm?.description as string | undefined,
    template: (fm?.template as string | undefined) ?? getTemplateBody(content),
    loop: fm?.loop as { max: number; until: string } | undefined,
    model: fm?.model as string | undefined,
    auto: fm?.subtask2 === 'auto',
  }
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    return null
  }
  const fm: Record<string, unknown> = {}
  const lines = match[1].split('\n')
  let currentKey: string | null = null
  let currentList: string[] | null = null

  for (const line of lines) {
    const listMatch = line.match(/^(\s*)- (.*)$/)
    if (listMatch && currentKey) {
      currentList ??= []
      currentList.push(listMatch[2].trim())
      continue
    }
    currentList = null
    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1]
      const value = kvMatch[2].trim()
      if (value === '') {
        fm[currentKey] = ''
      } else if (value.startsWith('[') || value.startsWith('"')) {
        try {
          fm[currentKey] = JSON.parse(value)
        } catch {
          fm[currentKey] = value
        }
      } else {
        fm[currentKey] = value
      }
    }
  }

  return fm
}

function getTemplateBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  if (!match) {
    return content.trim()
  }
  return match[1].trim()
}

function parseParallelConfig(raw: unknown): string[] {
  if (!raw) {
    return []
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') {
        return item
      }
      if (item && typeof item === 'object' && 'command' in item) {
        return String((item as Record<string, unknown>).command)
      }
      return String(item)
    })
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

// ============================================================================
// Parsing
// ============================================================================

function parseOverridesFromArgs(
  args: string
): { overrides: InlineSubtask['overrides']; rest: string } | null {
  const trimmed = args.trim()
  if (!trimmed.startsWith('{')) {
    return null
  }
  const braceEnd = findMatchingBrace(trimmed)
  if (braceEnd === -1) {
    return null
  }
  const overridesText = trimmed.slice(0, braceEnd + 1)
  const rest = trimmed.slice(braceEnd + 1).trim()
  const overrides = parseOverridesObject(overridesText)
  return { overrides, rest }
}

function findMatchingBrace(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    if (depth === 0) {
      return i
    }
  }
  return -1
}

function parseOverridesObject(text: string): InlineSubtask['overrides'] {
  const overrides: InlineSubtask['overrides'] = {}
  const inner = text.slice(1, -1)
  const agentMatch = inner.match(/agent:\s*([^,\s}]+)/)
  const modelMatch = inner.match(/model:\s*([^,\s}]+)/)
  const loopMatch = inner.match(/loop:\s*(\d+)(?:\s*&&\s*until:([^}]+))?/)
  const asMatch = inner.match(/as:\s*([^,\s}]+)/)
  const autoMatch = inner.match(/auto:\s*(true|false)/)
  const returnMatch = inner.match(/return:([^}]+)/)
  const parallelMatch = inner.match(/parallel:([^}]+)/)

  const agentCapture = agentMatch ? (agentMatch[1] as string) : undefined
  const modelCapture = modelMatch ? (modelMatch[1] as string) : undefined
  const loopCapture = loopMatch ? (loopMatch[1] as string) : undefined
  const untilCapture = loopMatch ? (loopMatch[2] as string | undefined) : undefined
  const asCapture = asMatch ? (asMatch[1] as string) : undefined
  const autoCapture = autoMatch ? (autoMatch[1] as string) : undefined
  const returnCapture = returnMatch ? (returnMatch[1] as string) : undefined
  const parallelCapture = parallelMatch ? (parallelMatch[1] as string) : undefined

  if (agentCapture) overrides.agent = agentCapture.trim()
  if (modelCapture) overrides.model = modelCapture.trim()
  if (loopCapture) {
    overrides.loop = {
      max: parseInt(loopCapture, 10) || 5,
      until: untilCapture?.trim() || '',
    }
  }
  if (asCapture) overrides.as = asCapture.trim()
  if (autoCapture && autoCapture === 'true') overrides.auto = true
  if (returnCapture) {
    overrides.return = returnCapture
      .split('||')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (parallelCapture) {
    overrides.parallel = parallelCapture
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return overrides
}

function parseInlineSubtask(args: string): InlineSubtask | null {
  const overridesResult = parseOverridesFromArgs(args)
  if (!overridesResult) {
    return null
  }
  const prompt = overridesResult.rest.trim()
  if (!prompt) {
    return null
  }
  return {
    prompt,
    overrides: overridesResult.overrides,
  }
}

function hasTurnReferences(text: string): boolean {
  return /\$TURN\[[^\]]*\]/.test(text)
}

async function resolveTurnReferences(text: string, sessionID: string): Promise<string> {
  // Minimal turn reference resolution: replace $TURN[n] with placeholder.
  // Full implementation would fetch session history via client.session.messages().
  return text.replace(/\$TURN\[[^\]]*\]/g, '[prior context]')
}

function splitArgs(args: string): { main: string; piped: string[] } {
  const segments = args.split('||').map((s) => s.trim())
  return {
    main: segments[0] ?? '',
    piped: segments.slice(1),
  }
}

// ============================================================================
// Subtask part builder
// ============================================================================

interface SubtaskPartDraft {
  type: 'subtask'
  prompt: string
  description?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  as?: string
}

async function buildInlineSubtaskPart(
  parsed: InlineSubtask,
  sessionID: string
): Promise<SubtaskPartDraft> {
  const prompt = await resolveTurnReferences(parsed.prompt, sessionID)
  const part: SubtaskPartDraft = {
    type: 'subtask',
    prompt,
  }

  if (parsed.overrides.agent) {
    part.agent = parsed.overrides.agent
  }
  if (parsed.overrides.model?.includes('/')) {
    const [providerID, ...rest] = parsed.overrides.model.split('/')
    part.model = { providerID, modelID: rest.join('/') }
  }
  if (parsed.overrides.as) {
    part.as = parsed.overrides.as
  }

  return part
}

async function waitForAssistantCompletion(
  client: any,
  sessionID: string,
  timeoutMs = 2 * 60 * 1000
): Promise<string> {
  const start = Date.now()
  const pollInterval = 1000

  while (Date.now() - start < timeoutMs) {
    const result = await client.session.messages({
      path: { id: sessionID },
    })

    const messages = result.data ?? []
    const assistantMessages = messages
      .filter((m: any) => m.info?.role === 'assistant')
      .sort((a: any, b: any) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))

    const latest = assistantMessages[0]
    if (latest?.info?.time?.completed) {
      return (latest.parts ?? [])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n')
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return '(no response)'
}

// ============================================================================
// Command hooks
// ============================================================================

async function commandExecuteBefore(
  input: { command: string; sessionID: string; arguments: string },
  output: { parts: Part[] }
): Promise<void> {
  const cmd = input.command
  const args = input.arguments ?? ''

  // Intercept /subtask inline syntax.
  if (cmd === 'subtask' && args) {
    const trimmed = args.trim()
    let parsed: InlineSubtask | null = null

    if (trimmed.startsWith('{')) {
      parsed = parseInlineSubtask(trimmed)
    } else if (trimmed.length > 0) {
      parsed = { prompt: trimmed, overrides: {} }
    }

    if (parsed) {
      if (parsed.overrides.auto) {
        log('Auto workflow not yet implemented')
        return
      }

      const subtaskPart = await buildInlineSubtaskPart(parsed, input.sessionID)
      // The runtime accepts subtask parts before id/sessionID/messageID are materialized.
      // Cast bridges the typed Part boundary with the plugin's internal draft shape.
      output.parts = [subtaskPart as Part]
      log(`/subtask intercepted: prompt="${parsed.prompt.substring(0, 50)}..."`)
      return
    }
  }

  // Existing command handling.
  const commandConfig = configs.get(cmd)
  if (!commandConfig) {
    return
  }

  setSessionMainCommand(input.sessionID, cmd)

  if (commandConfig.auto) {
    log(`Auto workflow not yet implemented for ${cmd}`)
    return
  }

  // Loop handling.
  const loopConfig = commandConfig.loop
  if (loopConfig && !getLoopState(input.sessionID)) {
    const effectiveArgs = args
    const inlineOverrides = parseOverridesFromArgs(effectiveArgs)
    startLoop(
      input.sessionID,
      loopConfig,
      cmd,
      inlineOverrides?.rest ?? effectiveArgs,
      inlineOverrides?.overrides.model
        ? {
            providerID: inlineOverrides.overrides.model.split('/')[0] ?? '',
            modelID: inlineOverrides.overrides.model.split('/').slice(1).join('/') ?? '',
          }
        : undefined,
      inlineOverrides?.overrides.agent
    )
  }

  // Model/agent overrides.
  const inlineOverrides = parseOverridesFromArgs(args)
  const pendingModel = getPendingModelOverride(input.sessionID)
  const pendingAgent = getPendingAgentOverride(input.sessionID)
  const modelOverride = inlineOverrides?.overrides.model
    ? {
        providerID: inlineOverrides.overrides.model.split('/')[0] ?? '',
        modelID: inlineOverrides.overrides.model.split('/').slice(1).join('/') ?? '',
      }
    : pendingModel
      ? { providerID: pendingModel.providerID, modelID: pendingModel.modelID }
      : undefined
  const agentOverride = inlineOverrides?.overrides.agent ?? pendingAgent

  if (pendingModel) deletePendingModelOverride(input.sessionID)
  if (pendingAgent) deletePendingAgentOverride(input.sessionID)

  if (modelOverride) {
    for (const part of output.parts) {
      if (part.type === 'subtask') {
        // Internal subtask parts carry an extended model override not present in the
        // exported Part union; cast at the mutation site only.
        ;(part as { model?: { providerID: string; modelID: string } }).model = modelOverride
      }
    }
  }
  if (agentOverride) {
    for (const part of output.parts) {
      if (part.type === 'subtask') {
        part.agent = agentOverride
      }
    }
  }

  // Pipe args.
  const { main: mainArgs, piped } = splitArgs(args)
  if (piped.length > 0) {
    setPipedArgsQueue(input.sessionID, piped)
  }

  // $TURN resolution.
  if (hasTurnReferences(mainArgs)) {
    output.parts = output.parts.map((part) => {
      if (part.type === 'text' && part.text) {
        part.text = part.text.replace(/\$TURN\[[^\]]*\]/g, '[prior context]')
      }
      return part
    })
  }

  for (const part of output.parts) {
    if (part.type === 'subtask' && part.prompt) {
      if (hasTurnReferences(part.prompt)) {
        part.prompt = part.prompt.replace(/\$TURN\[[^\]]*\]/g, '[prior context]')
      }
      registerPendingParentForPrompt(part.prompt, input.sessionID)
      // `as` is an internal extension on subtask parts; cast through unknown at the read site only.
      const extended = part as unknown as { as?: string }
      if (extended.as) {
        registerPendingResultCaptureByPrompt(part.prompt, input.sessionID, extended.as)
      }
    }
  }

  const hasSubtaskPart = output.parts.some((p) => p.type === 'subtask')
  if (!hasSubtaskPart && commandConfig.return?.length) {
    setPendingNonSubtaskReturns(input.sessionID, [...commandConfig.return])
  }
}

// ============================================================================
// Tool hooks
// ============================================================================

async function toolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any }
): Promise<void> {
  // Placeholder restoration would go here.
}

async function toolExecuteAfter(
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: { title: string; output: string; metadata: any }
): Promise<void> {
  // Desensitization would go here.
}

// ============================================================================
// Message hooks
// ============================================================================

async function chatMessagesTransform(
  input: {},
  output: { messages: { info: Message; parts: Part[] }[] }
): Promise<void> {
  // Replace generic subtask completion prompt when configured.
  if (!pluginConfig.replace_generic) {
    return
  }

  output.messages = output.messages.map((message) => {
    if (!message.parts) {
      return message
    }
    const updatedParts = message.parts.map((part: Part) => {
      if (part.type === 'text' && part.text?.includes('Summarize the task tool output')) {
        const custom = consumePendingPromptReturn(message.info.sessionID)
        if (custom) {
          return { ...part, text: custom }
        }
        return {
          ...part,
          text: 'Review, challenge and verify the task tool output above against the codebase. Then validate or revise it, before continuing with the next logical step.',
        }
      }
      return part
    })
    return { ...message, parts: updatedParts }
  })
}

// ============================================================================
// Event hooks
// ============================================================================

async function handleSessionIdle(sessionID: string) {
  if (hasPendingStackedPromptResponse(sessionID)) {
    clearPendingStackedPromptResponse(sessionID)
    return
  }

  // Loop evaluation would go here.
  const loop = getLoopState(sessionID)
  if (loop) {
    // Minimal loop handling: increment counter and decide whether to continue.
    // Full implementation would prompt the model to evaluate the until condition.
    loop.current += 1
    if (loop.current >= loop.max) {
      clearLoopState(sessionID)
    }
  }
}

// ============================================================================
// Plugin entry
// ============================================================================

export default async (input: PluginInput): Promise<Hooks> => {
  setClient(input.client)

  const commandDirs = [
    join(process.env.HOME ?? '', '.config', 'opencode', 'commands'),
    join(input.directory, '.opencode', 'commands'),
  ]

  for (const dir of commandDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue
        }
        const fullPath = join(entry.parentPath ?? dir, entry.name)
        const content = await readFile(fullPath, 'utf-8')
        const name = entry.name.replace(/\.md$/, '')
        const commandConfig = parseCommandFile(name, content)
        if (commandConfig) {
          configs.set(name, commandConfig)
          // Also store path-qualified key for subfolder commands.
          const relativePath = fullPath
            .replace(dir, '')
            .replace(/^[\\/]/, '')
            .replace(/\.md$/, '')
          if (relativePath !== name) {
            configs.set(relativePath, commandConfig)
          }
        }
      }
    } catch {
      // Directory may not exist; continue.
    }
  }

  log(`Registered commands: ${[...configs.keys()].join(', ')}`)

  return {
    config: async (input: Config) => {
      if (!input || typeof input !== 'object') return
      const cfg = input as Record<string, unknown>
      if (!cfg.command || typeof cfg.command !== 'object') {
        cfg.command = {}
      }
      ;(cfg.command as Record<string, unknown>).subtask = {
        description: 'Run a command on the fly, supports subtask features',
        template: '$ARGUMENTS',
        subtask: true,
      }
      log('Registered /subtask command')
    },

    tool: {
      task: tool({
        description:
          'Delegate a task to a Baba subagent. Routes through baba-sensei, baba-dev, baba-tester, baba-reviewer, or baba-scrum.',
        args: {
          prompt: tool.schema.string().describe('The task prompt to delegate'),
          agent: tool.schema
            .string()
            .optional()
            .describe('Baba agent to delegate to (default: baba-sensei)'),
        },
        async execute(args, context) {
          const agent = args.agent ?? 'baba-sensei'
          if (!BABA_AGENTS.includes(agent)) {
            return `Error: unknown agent "${agent}". Available: ${BABA_AGENTS.join(', ')}`
          }
          try {
            const child = await (input.client as any).session.create({
              body: {
                title: args.prompt.slice(0, 80),
                agent,
              },
            })
            await (input.client as any).session.prompt({
              path: { id: child.data.id },
              body: {
                parts: [{ type: 'text', text: args.prompt }],
              },
            })
            const text = await waitForAssistantCompletion(input.client as any, child.data.id)
            return text || '(no response)'
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
      evaluateSession: tool({
        description:
          'Run a close-session evaluation by delegating to baba-reviewer with the standard session evaluation prompt.',
        args: {
          session_id: tool.schema.string().describe('The session ID to evaluate'),
          final_phase: tool.schema.string().describe('The final phase of the session'),
          mode: tool.schema.string().describe('Execution mode: AUTO, DIRECT, or STRUCTURED'),
          edits_made: tool.schema.boolean().describe('Whether the session made file edits'),
          final_commit: tool.schema.string().optional().describe('Final commit SHA or n/a'),
        },
        async execute(args) {
          const prompt = `Evaluate this session against the prompt-system protocol and produce a structured assessment.

Session ID: ${args.session_id}
Final phase: ${args.final_phase}
Mode: ${args.mode}
Edits made: ${args.edits_made ? 'yes' : 'no'}
Final commit: ${args.final_commit ?? 'n/a'}

Read the session state file \`SESSION_STATE-${args.session_id}.md\` and assess:

1. Session outcome: completed / blocked / partial / failed
2. Phase efficiency: which phases ran, which skipped, token cost per phase (from Read Ledger)
3. Protocol compliance: hard guard triggers, breach types, skip reasons
4. Plan-actual fidelity: GREEN/RED/SKIPPED, retry count, scope violations
5. Findings: confirmed vs disputed, mitigation choices, pending items
6. Bug fix quality: regression tests added, baseline/post-fix results
7. Drift: diverged claims, orphaned mappings, code-exceeds-spec
8. Key decisions: A/B/C/skip/accept distribution, time-to-decision
9. Lessons: what slowed the session, what worked well

Output format:
- Verdict: PASS (session completed cleanly) | FAIL (session had significant protocol or quality issues) | SKIPPED (trivial session, no evaluation warranted)
- Summary: one-line assessment
- Strengths: 1-3 bullet points
- Improvements: 1-3 bullet points
- Metrics: session duration, phases completed, findings count, plan-actual verdict`

          const agent = 'baba-reviewer'
          try {
            const child = await (input.client as any).session.create({
              body: {
                title: `session eval ${args.session_id}`,
                agent,
              },
            })
            await (input.client as any).session.prompt({
              path: { id: child.data.id },
              body: {
                parts: [{ type: 'text', text: prompt }],
              },
            })
            const text = await waitForAssistantCompletion(input.client as any, child.data.id)
            return text || '(no response)'
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },

    'command.execute.before': commandExecuteBefore,

    'tool.execute.before': toolExecuteBefore,

    'tool.execute.after': toolExecuteAfter,

    'experimental.chat.messages.transform': chatMessagesTransform,

    event: async ({ event }: { event: Event }) => {
      if (event.type === 'session.idle' && 'properties' in event && event.properties.sessionID) {
        await handleSessionIdle(event.properties.sessionID)
      }
    },
  }
}
