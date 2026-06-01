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
  discoveryPhaseComplete: boolean
  discoveredConversations: ConversationMeta[]
  processedIds: string[]
}

export class CheckpointManager {
  private readonly path: string
  private state: CheckpointData

  constructor(config: Config) {
    this.path = config.checkpointPath
    this.state = this.load()
  }

  setDiscoveredConversations(newlyDiscovered: ConversationMeta[]): void {
    this.state.discoveredConversations = newlyDiscovered.map(n => {
      const existing = this.state.discoveredConversations.find(e => e.id === n.id)
      return existing ? { ...n, contentHash: existing.contentHash } : n
    })
    this.state.discoveryPhaseComplete = true
    this.save()
  }

  isDiscoveryPhaseComplete(): boolean {
    return this.state.discoveryPhaseComplete
  }

  getPendingConversations(): ConversationMeta[] {
    const processedSet = new Set(this.state.processedIds)
    return this.state.discoveredConversations.filter(c => !processedSet.has(c.id))
  }

  getContentHash(id: string): string | undefined {
    return this.state.discoveredConversations.find(c => c.id === id)?.contentHash
  }

  markAsProcessed(id: string, hash?: string): void {
    let changed = false
    const processedSet = new Set(this.state.processedIds)
    if (!processedSet.has(id)) {
      this.state.processedIds.push(id)
      changed = true
    }

    if (hash) {
      const target = this.state.discoveredConversations.find(c => c.id === id)
      if (target && target.contentHash !== hash) {
        target.contentHash = hash
        changed = true
      }
    }

    if (changed) this.save()
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
    this.save()
  }

  resetCheckpoint(): void {
    this.state = { discoveryPhaseComplete: false, discoveredConversations: [], processedIds: [] }
    this.save()
  }

  private load(): CheckpointData {
    if (existsSync(this.path)) {
      try {
        return JSON.parse(readFileSync(this.path, 'utf-8'))
      } catch (e) {
        errorBus.emitError('Failed to load checkpoint', e)
      }
    }
    return { discoveryPhaseComplete: false, discoveredConversations: [], processedIds: [] }
  }

  private async save() {
    try {
      await (writeFileAtomic as any)(this.path, JSON.stringify(this.state, null, 2))
    } catch (e) {
      errorBus.emitError('Failed to save checkpoint', e)
    }
  }
}
