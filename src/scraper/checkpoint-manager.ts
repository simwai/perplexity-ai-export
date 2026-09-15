import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import { createResult, ok, type Result } from 'super-result'
import { logger } from '../utils/logger.js'
import { z } from 'zod'

export interface ConversationMeta {
  id: string
  url: string
  contentHash?: string
}

export interface ProgressState {
  processed: number
  total: number
}

const CheckpointDataSchema = z.object({
  discoveryPhaseComplete: z.boolean(),
  discoveredConversations: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      contentHash: z.string().optional(),
    })
  ),
  processedIds: z.array(z.string()),
})

type CheckpointData = z.infer<typeof CheckpointDataSchema>

export class CheckpointManager {
  private readonly checkpointFilePath: string
  private currentState: CheckpointData

  private readonly resultFactory = createResult<Error>((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  )

  constructor(config: Config) {
    this.checkpointFilePath = config.checkpointPath
    const loadResult = this.loadCheckpoint()
    this.currentState = loadResult.ok
      ? loadResult.value
      : {
          discoveryPhaseComplete: false,
          discoveredConversations: [],
          processedIds: [],
        }
  }

  async setDiscoveredConversations(
    newlyDiscoveredConversations: ConversationMeta[]
  ): Promise<Result<void, Error>> {
    this.currentState.discoveredConversations = newlyDiscoveredConversations.map((newConv) => {
      const existingConversation = this.currentState.discoveredConversations.find(
        (existing) => existing.id === newConv.id
      )
      return existingConversation
        ? { ...newConv, contentHash: existingConversation.contentHash }
        : newConv
    })
    this.currentState.discoveryPhaseComplete = true
    return this.saveCheckpoint()
  }

  isDiscoveryPhaseComplete(): boolean {
    return this.currentState.discoveryPhaseComplete
  }

  getPendingConversations(): ConversationMeta[] {
    return this.currentState.discoveredConversations.filter(
      (conversation) => !this.currentState.processedIds.includes(conversation.id)
    )
  }

  getContentHash(conversationId: string): string | undefined {
    const conversation = this.currentState.discoveredConversations.find(
      (c) => c.id === conversationId
    )
    return conversation?.contentHash
  }

  async markAsProcessed(
    conversationId: string,
    updatedContentHash?: string
  ): Promise<Result<void, Error>> {
    let hasStateChanged = false

    const isAlreadyProcessed = this.currentState.processedIds.includes(conversationId)
    if (!isAlreadyProcessed) {
      this.currentState.processedIds.push(conversationId)
      hasStateChanged = true
    }

    if (updatedContentHash) {
      const targetConversation = this.currentState.discoveredConversations.find(
        (c) => c.id === conversationId
      )
      const isHashDifferent =
        targetConversation && targetConversation.contentHash !== updatedContentHash

      if (isHashDifferent) {
        targetConversation.contentHash = updatedContentHash
        hasStateChanged = true
      }
    }

    if (hasStateChanged) {
      return this.saveCheckpoint()
    }
    return ok(undefined)
  }

  getProcessingProgress(): ProgressState {
    return {
      processed: this.currentState.processedIds.length,
      total: this.currentState.discoveredConversations.length,
    }
  }

  async prepareForUpdateRun(): Promise<Result<void, Error>> {
    this.currentState.processedIds = []
    this.currentState.discoveryPhaseComplete = false
    return this.saveCheckpoint()
  }

  async resetCheckpoint(): Promise<Result<void, Error>> {
    this.currentState = {
      discoveryPhaseComplete: false,
      discoveredConversations: [],
      processedIds: [],
    }
    return this.saveCheckpoint()
  }

  private loadCheckpoint(): Result<CheckpointData, Error> {
    const doesCheckpointExist = existsSync(this.checkpointFilePath)
    if (!doesCheckpointExist) {
      return ok({
        discoveryPhaseComplete: false,
        discoveredConversations: [],
        processedIds: [],
      })
    }

    const readResult = this.resultFactory.from(() => readFileSync(this.checkpointFilePath, 'utf-8'))
    if (!readResult.ok) return readResult

    const parsedResult = this.resultFactory.from(() => JSON.parse(readResult.value))
    if (!parsedResult.ok) return parsedResult

    const validateResult = CheckpointDataSchema.safeParse(parsedResult.value)
    if (!validateResult.success) {
      logger.warn(
        `Corrupt checkpoint file at ${this.checkpointFilePath}, resetting to defaults: ${validateResult.error}`
      )
      return ok({
        discoveryPhaseComplete: false,
        discoveredConversations: [],
        processedIds: [],
      })
    }

    return ok(validateResult.data)
  }

  private saveCheckpoint(): Result<void, Error> {
    const serializeResult = this.resultFactory.from(() =>
      JSON.stringify(this.currentState, null, 2)
    )
    if (!serializeResult.ok) return serializeResult

    const tmpPath = `${this.checkpointFilePath}.tmp`
    const writeResult = this.resultFactory.from(() => writeFileSync(tmpPath, serializeResult.value))
    if (!writeResult.ok) return writeResult

    const renameResult = this.resultFactory.from(() => renameSync(tmpPath, this.checkpointFilePath))
    if (!renameResult.ok) return renameResult

    return ok(undefined)
  }
}
