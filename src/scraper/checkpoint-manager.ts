import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export interface SpaceMetadata {
  url: string
  name: string
}

export interface ConversationMetadata {
  url: string
  title: string
  spaceName: string
  timestamp?: string
}

export interface Checkpoint {
  spaces: SpaceMetadata[]
  discoveredConversations: ConversationMetadata[]
  processedUrls: string[]
  discoveryCompleted: boolean
  lastUpdated: string
  totalProcessed: number
}

export class CheckpointManager {
  static readonly LoadError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointLoadError'
    }
  }

  static readonly SaveError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointSaveError'
    }
  }

  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointValidationError'
    }
  }

  private currentCheckpoint: Checkpoint
  private pendingOperationsSinceLastSave = 0

  constructor() {
    this.currentCheckpoint = this.loadCheckpointFromDisk()
  }

  setSpaces(spaces: SpaceMetadata[]): void {
    this.currentCheckpoint.spaces = spaces
    this.saveCheckpointToDisk()
    logger.success(`Space discovery complete: ${spaces.length} spaces found`)
  }

  getSpaces(): SpaceMetadata[] {
    return this.currentCheckpoint.spaces
  }

  setDiscoveredConversations(conversations: ConversationMetadata[]): void {
    this.currentCheckpoint.discoveredConversations = conversations
    this.currentCheckpoint.discoveryCompleted = true
    this.saveCheckpointToDisk()
    logger.success(`Discovery complete: ${conversations.length} conversations found`)
  }

  markProcessed(url: string): void {
    if (this.currentCheckpoint.processedUrls.includes(url)) return

    this.currentCheckpoint.processedUrls.push(url)
    this.currentCheckpoint.totalProcessed++
    this.pendingOperationsSinceLastSave++

    if (this.pendingOperationsSinceLastSave >= config.checkpointSaveInterval) {
      this.saveCheckpointToDisk()
      logger.debug(`Checkpoint saved (${this.currentCheckpoint.totalProcessed} processed)`)
      this.pendingOperationsSinceLastSave = 0
    }
  }

  getPendingConversations(): ConversationMetadata[] {
    return this.currentCheckpoint.discoveredConversations.filter(
      (conv) => !this.currentCheckpoint.processedUrls.includes(conv.url)
    )
  }

  getProcessingProgress(): { total: number; processed: number; pending: number } {
    const totalCount = this.currentCheckpoint.discoveredConversations.length
    const processedCount = this.currentCheckpoint.processedUrls.length
    return { total: totalCount, processed: processedCount, pending: totalCount - processedCount }
  }

  isDiscoveryPhaseComplete(): boolean {
    return this.currentCheckpoint.discoveryCompleted
  }

  resetCheckpoint(): void {
    this.currentCheckpoint = this.createInitialCheckpoint()
    this.saveCheckpointToDisk()
    logger.info('Checkpoint reset')
  }

  performFinalSave(): void {
    this.saveCheckpointToDisk()
    logger.success(
      `Final checkpoint saved: ${this.currentCheckpoint.totalProcessed} conversations processed`
    )
  }

  private loadCheckpointFromDisk(): Checkpoint {
    if (!existsSync(config.checkpointPath)) {
      return this.createInitialCheckpoint()
    }

    try {
      const checkpointFileContent = readFileSync(config.checkpointPath, 'utf-8')
      const parsedCheckpointData = JSON.parse(checkpointFileContent)
      this.assertValidCheckpointStructure(parsedCheckpointData)
      return parsedCheckpointData
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.warn(`Failed to load checkpoint (${errorMessage}), starting fresh`)
      return this.createInitialCheckpoint()
    }
  }

  private assertValidCheckpointStructure(data: any): asserts data is Checkpoint {
    if (!data || typeof data !== 'object') {
      throw new CheckpointManager.ValidationError('Checkpoint is not an object')
    }

    const requiredKeys: (keyof Checkpoint)[] = [
      'spaces',
      'discoveredConversations',
      'processedUrls',
      'discoveryCompleted',
      'lastUpdated',
      'totalProcessed',
    ]

    for (const key of requiredKeys) {
      if (!(key in data)) {
        throw new CheckpointManager.ValidationError(`Missing required field: ${key}`)
      }
    }
  }

  private createInitialCheckpoint(): Checkpoint {
    return {
      spaces: [],
      discoveredConversations: [],
      processedUrls: [],
      discoveryCompleted: false,
      lastUpdated: new Date().toISOString(),
      totalProcessed: 0,
    }
  }

  private saveCheckpointToDisk(): void {
    this.currentCheckpoint.lastUpdated = new Date().toISOString()
    try {
      writeFileSync(config.checkpointPath, JSON.stringify(this.currentCheckpoint, null, 2))
    } catch (_error) {
      throw new CheckpointManager.SaveError(
        `Failed to write checkpoint: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }
}
