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

// ============================================================================
// Types
// ============================================================================

interface PluginContext {
  client: any
  $: any
  project: any
  directory: string
  worktree: string
}

interface CommandInput {
  command: string
  arguments: string
  sessionID: string
}

interface CommandOutput {
  parts: any[]
  abort?: boolean
}

interface ToolInput {
  name: string
  arguments: Record<string, unknown>
}

interface ToolOutput {
  result?: unknown
}

interface MessagePart {
  type: string
  text?: string
  prompt?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  as?: string
}

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

const BABA_AGENTS = ['baba-sensei', 'baba-dev', 'baba-tester', 'baba-reviewer', 'baba-scrummaster']

// ============================================================================
// Helpers
// ============================================================================

function log(...args: unknown[]) {
  console.log('[baba-subtask]', ...args)
}

function getConfigs(): Map<string, SubtaskConfig> {
  return configs
}

function getClient(): any {
  return client
}

function setClient(newClient: any) {
  client = newClient
}

function getPluginConfig() {
  return pluginConfig
}

function setPluginConfig(newConfig: Record<string, unknown>) {
  pluginConfig = { ...pluginConfig, ...newConfig }
}

function getPendingReturn(sessionID: string): string[] | undefined {
  return pendingReturns.get(sessionID)
}

function setPendingReturn(sessionID: string, returns: string[]) {
  pendingReturns.set(sessionID, returns)
}

function deletePendingReturn(sessionID: string) {
  pendingReturns.delete(sessionID)
}

function getPendingNonSubtaskReturns(sessionID: string): string[] | undefined {
  return pendingNonSubtaskReturns.get(sessionID)
}

function setPendingNonSubtaskReturns(sessionID: string, returns: string[]) {
  pendingNonSubtaskReturns.set(sessionID, returns)
}

function deletePendingNonSubtaskReturns(sessionID: string) {
  pendingNonSubtaskReturns.delete(sessionID)
}

function getPipedArgsQueue(sessionID: string): string[] | undefined {
  return pipedArgsQueue.get(sessionID)
}

function setPipedArgsQueue(sessionID: string, args: string[]) {
  pipedArgsQueue.set(sessionID, args)
}

function deletePipedArgsQueue(sessionID: string) {
  pipedArgsQueue.delete(sessionID)
}

function getSessionMainCommand(sessionID: string): string | undefined {
  return sessionMainCommand.get(sessionID)
}

function setSessionMainCommand(sessionID: string, cmd: string) {
  sessionMainCommand.set(sessionID, cmd)
}

function getLoopState(sessionID: string): LoopState | undefined {
  return loopState.get(sessionID)
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

function clearLoopState(sessionID: string) {
  loopState.delete(sessionID)
}

function getPendingModelOverride(sessionID: string) {
  return pendingModelOverride.get(sessionID)
}

function setPendingModelOverride(
  sessionID: string,
  model: { providerID: string; modelID: string }
) {
  pendingModelOverride.set(sessionID, model)
}

function deletePendingModelOverride(sessionID: string) {
  pendingModelOverride.delete(sessionID)
}

function getPendingAgentOverride(sessionID: string): string | undefined {
  return pendingAgentOverride.get(sessionID)
}

function setPendingAgentOverride(sessionID: string, agent: string) {
  pendingAgentOverride.set(sessionID, agent)
}

function deletePendingAgentOverride(sessionID: string) {
  pendingAgentOverride.delete(sessionID)
}

function registerPendingParentForPrompt(prompt: string, parentSessionID: string) {
  pendingParentByPrompt.set(prompt, parentSessionID)
}

function consumePendingParentForPrompt(prompt: string): string | null {
  const parent = pendingParentByPrompt.get(prompt)
  if (parent) {
    pendingParentByPrompt.delete(prompt)
  }
  return parent ?? null
}

function registerPendingResultCaptureByPrompt(
  prompt: string,
  parentSessionID: string,
  name: string
) {
  pendingResultCaptureByPrompt.set(prompt, { parentSessionID, name })
}

function consumePendingResultCaptureByPrompt(prompt: string) {
  const entry = pendingResultCaptureByPrompt.get(prompt)
  if (entry) {
    pendingResultCaptureByPrompt.delete(prompt)
  }
  return entry ?? null
}

function getSubtaskResult(sessionID: string, name: string) {
  return subtaskResults.get(sessionID)?.get(name)
}

function storeSubtaskResult(sessionID: string, name: string, result: unknown) {
  if (!subtaskResults.has(sessionID)) {
    subtaskResults.set(sessionID, new Map())
  }
  subtaskResults.get(sessionID)!.set(name, result)
}

function resolveResultReferences(text: string, sessionID: string): string {
  const results = subtaskResults.get(sessionID)
  if (!results || results.size === 0) {
    return text
  }
  return text.replace(/\$RESULT\[([^\]]+)\]/g, (match, name: string) => {
    const result = results.get(name)
    return result !== undefined ? String(result) : match
  })
}

function setPendingStackedPromptResponse(sessionID: string) {
  pendingStackedPromptResponse.add(sessionID)
}

function hasPendingStackedPromptResponse(sessionID: string): boolean {
  return pendingStackedPromptResponse.has(sessionID)
}

function clearPendingStackedPromptResponse(sessionID: string) {
  pendingStackedPromptResponse.delete(sessionID)
}

function setPendingPromptReturn(sessionID: string, prompt: string) {
  pendingPromptReturn.set(sessionID, prompt)
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
    agent: fm?.agent,
    description: fm?.description,
    template: fm?.template ?? getTemplateBody(content),
    loop: fm?.loop,
    model: fm?.model,
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

  if (agentMatch) overrides.agent = agentMatch[1].trim()
  if (modelMatch) overrides.model = modelMatch[1].trim()
  if (loopMatch) {
    overrides.loop = {
      max: parseInt(loopMatch[1], 10) || 5,
      until: loopMatch[2]?.trim() || '',
    }
  }
  if (asMatch) overrides.as = asMatch[1].trim()
  if (autoMatch && autoMatch[1] === 'true') overrides.auto = true
  if (returnMatch) {
    overrides.return = returnMatch[1]
      .split('||')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (parallelMatch) {
    overrides.parallel = parallelMatch[1]
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

async function buildInlineSubtaskPart(
  parsed: InlineSubtask,
  sessionID: string
): Promise<MessagePart> {
  const prompt = await resolveTurnReferences(parsed.prompt, sessionID)
  const part: MessagePart = {
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

// ============================================================================
// Command hooks
// ============================================================================

async function commandExecuteBefore(
  input: CommandInput,
  output: CommandOutput
): Promise<CommandOutput> {
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
        return { ...output, abort: true }
      }

      const subtaskPart = await buildInlineSubtaskPart(parsed, input.sessionID)
      output.parts = [subtaskPart as any]
      log(`/subtask intercepted: prompt="${parsed.prompt.substring(0, 50)}..."`)
      return output
    }
  }

  // Existing command handling.
  const commandConfig = configs.get(cmd)
  if (!commandConfig) {
    return output
  }

  setSessionMainCommand(input.sessionID, cmd)

  if (commandConfig.auto) {
    log(`Auto workflow not yet implemented for ${cmd}`)
    return { ...output, abort: true }
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
      if (part.type === 'subtask' && part.model) {
        part.model = modelOverride
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
      if (part.as) {
        registerPendingResultCaptureByPrompt(part.prompt, input.sessionID, part.as)
      }
    }
  }

  const hasSubtaskPart = output.parts.some((p) => p.type === 'subtask')
  if (!hasSubtaskPart && commandConfig.return?.length) {
    setPendingNonSubtaskReturns(input.sessionID, [...commandConfig.return])
  }

  return output
}

// ============================================================================
// Tool hooks
// ============================================================================

async function toolExecuteBefore(input: ToolInput, output: ToolOutput): Promise<ToolOutput> {
  // Placeholder restoration would go here.
  return output
}

async function toolExecuteAfter(input: ToolInput, output: ToolOutput): Promise<ToolOutput> {
  // Desensitization would go here.
  return output
}

// ============================================================================
// Message hooks
// ============================================================================

async function chatMessagesTransform(messages: any[], sessionID: string): Promise<any[]> {
  // Replace generic subtask completion prompt when configured.
  if (!pluginConfig.replace_generic) {
    return messages
  }

  return messages.map((message) => {
    if (!message.parts) {
      return message
    }
    const updatedParts = message.parts.map((part: MessagePart) => {
      if (part.type === 'text' && part.text?.includes('Summarize the task tool output')) {
        const custom = getPendingPromptReturn(sessionID)
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

export default async ({ client: ctxClient, project, directory, worktree }: PluginContext) => {
  setClient(ctxClient)

  const commandDirs = [
    join(process.env.HOME ?? '', '.config', 'opencode', 'commands'),
    join(directory, '.opencode', 'commands'),
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
    config: async (input: { command?: Record<string, SubtaskConfig> }) => {
      input.command ??= {}
      input.command.subtask = {
        description: 'Run a command on the fly, supports subtask features',
        template: '$ARGUMENTS',
        subtask: true,
      }
      log('Registered /subtask command')
    },

    'command.execute.before': commandExecuteBefore,

    'tool.execute.before': toolExecuteBefore,

    'tool.execute.after': toolExecuteAfter,

    'experimental.chat.messages.transform': chatMessagesTransform,

    event: async ({ event }: { event: { type: string; properties: { sessionID?: string } } }) => {
      if (event.type === 'session.idle' && event.properties.sessionID) {
        await handleSessionIdle(event.properties.sessionID)
      }
    },
  }
}
