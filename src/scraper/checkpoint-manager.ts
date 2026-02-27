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
  private checkpoint: Checkpoint
  private saveCounter = 0

  constructor() {
    this.checkpoint = this.load()
  }

  setSpaces(spaces: SpaceMetadata[]): void {
    this.checkpoint.spaces = spaces
    this.save()
    logger.success(`Space discovery complete: ${spaces.length} spaces found`)
  }

  getSpaces(): SpaceMetadata[] {
    return this.checkpoint.spaces
  }

  private load(): Checkpoint {
    if (!existsSync(config.checkpointPath)) {
      return {
        spaces: [],
        discoveredConversations: [],
        processedUrls: [],
        discoveryCompleted: false,
        lastUpdated: new Date().toISOString(),
        totalProcessed: 0,
      }
    }

    try {
      const data = readFileSync(config.checkpointPath, 'utf-8')
      return JSON.parse(data)
    } catch (_error) {
      logger.warn('Failed to load checkpoint, starting fresh')
      return {
        spaces: [],
        discoveredConversations: [],
        processedUrls: [],
        discoveryCompleted: false,
        lastUpdated: new Date().toISOString(),
        totalProcessed: 0,
      }
    }
  }

  save(): void {
    this.checkpoint.lastUpdated = new Date().toISOString()
    writeFileSync(config.checkpointPath, JSON.stringify(this.checkpoint, null, 2))
  }

  setDiscoveredConversations(conversations: ConversationMetadata[]): void {
    this.checkpoint.discoveredConversations = conversations
    this.checkpoint.discoveryCompleted = true
    this.save()
    logger.success(`Discovery complete: ${conversations.length} conversations found`)
  }

  markProcessed(url: string): void {
    if (this.checkpoint.processedUrls.includes(url)) return

    this.checkpoint.processedUrls.push(url)
    this.checkpoint.totalProcessed++
    this.saveCounter++

    if (!(this.saveCounter >= config.checkpointSaveInterval)) return

    this.save()
    logger.debug(`Checkpoint saved (${this.checkpoint.totalProcessed} processed)`)
    this.saveCounter = 0
  }

  getPendingConversations(): ConversationMetadata[] {
    return this.checkpoint.discoveredConversations.filter(
      (conv) => !this.checkpoint.processedUrls.includes(conv.url)
    )
  }

  getProgress(): { total: number; processed: number; pending: number } {
    const total = this.checkpoint.discoveredConversations.length
    const processed = this.checkpoint.processedUrls.length
    return { total, processed, pending: total - processed }
  }

  isDiscoveryComplete(): boolean {
    return this.checkpoint.discoveryCompleted
  }

  reset(): void {
    this.checkpoint = {
      spaces: [],
      discoveredConversations: [],
      processedUrls: [],
      discoveryCompleted: false,
      lastUpdated: new Date().toISOString(),
      totalProcessed: 0,
    }
    this.save()
    logger.info('Checkpoint reset')
  }

  finalSave(): void {
    this.save()
    logger.success(
      `Final checkpoint saved: ${this.checkpoint.totalProcessed} conversations processed`
    )
  }
}
