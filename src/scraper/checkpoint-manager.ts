import { errorBus } from '../utils/error-bus.js'
import { readFileSync, existsSync } from 'node:fs'
import writeFileAtomic from 'write-file-atomic'
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
  isDiscoveryPhaseComplete: boolean
  discoveredConversations: ConversationMeta[]
  processedConversationIds: string[]
}

export class CheckpointManager {
  private readonly checkpointFilePath: string
  private currentCheckpointState: CheckpointData

  constructor(applicationConfig: Config) {
    this.checkpointFilePath = applicationConfig.checkpointPath
    this.currentCheckpointState = this.loadCheckpointFromDisk()
  }

  setDiscoveredConversations(newlyDiscoveredConversations: ConversationMeta[]): void {
    this.currentCheckpointState.discoveredConversations = newlyDiscoveredConversations.map(newConversation => {
      const existingConversation = this.currentCheckpointState.discoveredConversations.find(
        (existing) => existing.id === newConversation.id
      )
      return existingConversation
        ? { ...newConversation, contentHash: existingConversation.contentHash }
        : newConversation
    })
    this.currentCheckpointState.isDiscoveryPhaseComplete = true
    this.persistCheckpointToDisk()
  }

  isDiscoveryPhaseComplete(): boolean {
    return this.currentCheckpointState.isDiscoveryPhaseComplete
  }

  getPendingConversations(): ConversationMeta[] {
    const processedIdsSet = new Set(this.currentCheckpointState.processedConversationIds)
    return this.currentCheckpointState.discoveredConversations.filter(
      (conversation) => !processedIdsSet.has(conversation.id)
    )
  }

  getContentHash(conversationId: string): string | undefined {
    return this.currentCheckpointState.discoveredConversations.find(
      (conversation) => conversation.id === conversationId
    )?.contentHash
  }

  markAsProcessed(conversationId: string, updatedContentHash?: string): void {
    let hasStateChanged = false
    const processedIdsSet = new Set(this.currentCheckpointState.processedConversationIds)

    if (!processedIdsSet.has(conversationId)) {
      this.currentCheckpointState.processedConversationIds.push(conversationId)
      hasStateChanged = true
    }

    if (updatedContentHash) {
      const targetConversation = this.currentCheckpointState.discoveredConversations.find(
        (conversation) => conversation.id === conversationId
      )
      const isHashDifferent = targetConversation && targetConversation.contentHash !== updatedContentHash

      if (isHashDifferent) {
        targetConversation.contentHash = updatedContentHash
        hasStateChanged = true
      }
    }

    if (hasStateChanged) {
      this.persistCheckpointToDisk()
    }
  }

  getProcessingProgress(): ProgressState {
    return {
      processed: this.currentCheckpointState.processedConversationIds.length,
      total: this.currentCheckpointState.discoveredConversations.length,
    }
  }

  prepareForUpdateRun(): void {
    this.currentCheckpointState.processedConversationIds = []
    this.currentCheckpointState.isDiscoveryPhaseComplete = false
    this.persistCheckpointToDisk()
  }

  resetCheckpoint(): void {
    this.currentCheckpointState = {
      isDiscoveryPhaseComplete: false,
      discoveredConversations: [],
      processedConversationIds: []
    }
    this.persistCheckpointToDisk()
  }

  private loadCheckpointFromDisk(): CheckpointData {
    if (existsSync(this.checkpointFilePath)) {
      try {
        const rawJsonData = readFileSync(this.checkpointFilePath, 'utf-8')
        return JSON.parse(rawJsonData)
      } catch (loadError) {
        errorBus.emitError('Failed to load checkpoint file', loadError)
      }
    }
    return {
      isDiscoveryPhaseComplete: false,
      discoveredConversations: [],
      processedConversationIds: []
    }
  }

  private async persistCheckpointToDisk() {
    try {
      const serializedStateJson = JSON.stringify(this.currentCheckpointState, null, 2)
      await (writeFileAtomic as any)(this.checkpointFilePath, serializedStateJson)
    } catch (saveError) {
      errorBus.emitError('Failed to save checkpoint file', saveError)
    }
  }
}
