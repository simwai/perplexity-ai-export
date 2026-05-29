import { errorBus } from '../utils/error-bus.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { type Config } from '../utils/config.js'

export interface ConversationMeta {
  id: string
  url: string
  contentHash?: string
}

export interface ProgressState {
  processed: number
  total: number
}

interface CheckpointData {
  discoveryPhaseComplete: boolean
  discoveredConversations: ConversationMeta[]
  processedIds: string[]
}

export class CheckpointManager {
  private readonly checkpointFilePath: string
  private currentState: CheckpointData

  constructor(config: Config) {
    this.checkpointFilePath = config.checkpointPath
    this.currentState = this.loadCheckpoint()
  }

  setDiscoveredConversations(newlyDiscoveredConversations: ConversationMeta[]): void {
    // Preserve content hashes for already known conversations
    this.currentState.discoveredConversations = newlyDiscoveredConversations.map((newConv) => {
      const existingConversation = this.currentState.discoveredConversations.find(
        (existing) => existing.id === newConv.id
      )
      return existingConversation
        ? { ...newConv, contentHash: existingConversation.contentHash }
        : newConv
    })
    this.currentState.discoveryPhaseComplete = true
    this.saveCheckpoint()
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

  markAsProcessed(conversationId: string, updatedContentHash?: string): void {
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
      this.saveCheckpoint()
    }
  }

  getProcessingProgress(): ProgressState {
    return {
      processed: this.currentState.processedIds.length,
      total: this.currentState.discoveredConversations.length,
    }
  }

  prepareForUpdateRun(): void {
    this.currentState.processedIds = []
    this.currentState.discoveryPhaseComplete = false
    this.saveCheckpoint()
  }

  resetCheckpoint(): void {
    this.currentState = {
      discoveryPhaseComplete: false,
      discoveredConversations: [],
      processedIds: [],
    }
    this.saveCheckpoint()
  }

  private loadCheckpoint(): CheckpointData {
    const doesCheckpointExist = existsSync(this.checkpointFilePath)
    if (doesCheckpointExist) {
      try {
        const rawCheckpointData = readFileSync(this.checkpointFilePath, 'utf-8')
        return JSON.parse(rawCheckpointData)
      } catch (error) {
        errorBus.emitError('Failed to load checkpoint file. Starting fresh.', error)
      }
    }

    return {
      discoveryPhaseComplete: false,
      discoveredConversations: [],
      processedIds: [],
    }
  }

  private saveCheckpoint(): void {
    try {
      const serializedState = JSON.stringify(this.currentState, null, 2)
      writeFileSync(this.checkpointFilePath, serializedState)
    } catch (error) {
      errorBus.emitError('Failed to save checkpoint file', error)
    }
  }
}
