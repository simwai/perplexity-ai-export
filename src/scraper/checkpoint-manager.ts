import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export interface ConversationMeta {
  id: string
  url: string
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
    this.state.discoveredConversations = conversations
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

  markAsProcessed(id: string): void {
    if (!this.state.processedIds.includes(id)) {
      this.state.processedIds.push(id)
      this.saveCheckpoint()
    }
  }

  getProcessingProgress(): ProgressState {
    return {
      processed: this.state.processedIds.length,
      total: this.state.discoveredConversations.length,
    }
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
        logger.error('Failed to load checkpoint file. Starting fresh.')
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
      logger.error('Failed to save checkpoint file:', _error)
    }
  }
}
