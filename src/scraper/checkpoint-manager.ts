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
  private checkpointPath: string
  private state: CheckpointData

  constructor(config: Config) {
    this.checkpointPath = config.checkpointPath
    this.state = this.loadCheckpoint()
  }

  setDiscoveredConversations(conversations: ConversationMeta[]): void {
    // Preserve content hashes for existing conversations
    this.state.discoveredConversations = conversations.map((newConv) => {
      const existing = this.state.discoveredConversations.find((c) => c.id === newConv.id)
      return existing ? { ...newConv, contentHash: existing.contentHash } : newConv
    })
    this.state.discoveryPhaseComplete = true
    this.saveCheckpoint()
  }

  isDiscoveryPhaseComplete(): boolean {
    return this.state.discoveryPhaseComplete
  }

  getPendingConversations(): ConversationMeta[] {
    return this.state.discoveredConversations.filter(
      (conv) => !this.state.processedIds.includes(conv.id)
    )
  }

  getContentHash(id: string): string | undefined {
    return this.state.discoveredConversations.find((c) => c.id === id)?.contentHash
  }

  markAsProcessed(id: string, contentHash?: string): void {
    let changed = false
    if (!this.state.processedIds.includes(id)) {
      this.state.processedIds.push(id)
      changed = true
    }

    if (contentHash) {
      const conv = this.state.discoveredConversations.find((c) => c.id === id)
      if (conv && conv.contentHash !== contentHash) {
        conv.contentHash = contentHash
        changed = true
      }
    }

    if (changed) {
      this.saveCheckpoint()
    }
  }

  getProcessingProgress(): ProgressState {
    return {
      processed: this.state.processedIds.length,
      total: this.state.discoveredConversations.length,
    }
  }

  prepareForUpdateRun(): void {
    this.state.processedIds = []
    this.state.discoveryPhaseComplete = false
    this.saveCheckpoint()
  }

  resetCheckpoint(): void {
    this.state = {
      discoveryPhaseComplete: false,
      discoveredConversations: [],
      processedIds: [],
    }
    this.saveCheckpoint()
  }

  private loadCheckpoint(): CheckpointData {
    if (existsSync(this.checkpointPath)) {
      try {
        const data = readFileSync(this.checkpointPath, 'utf-8')
        return JSON.parse(data)
      } catch (_error) {
        errorBus.emitError('Failed to load checkpoint file. Starting fresh.')
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
      writeFileSync(this.checkpointPath, JSON.stringify(this.state, null, 2))
    } catch (_error) {
      errorBus.emitError('Failed to save checkpoint file', _error)
    }
  }
}
