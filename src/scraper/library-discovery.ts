import type { Page } from 'patchright'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import type { ConversationMetadata } from './checkpoint-manager.js'
import {
  ApiDiscoveryStrategy,
  ScrollDiscoveryStrategy,
  InteractionDiscoveryStrategy,
  AiAssistedDiscoveryStrategy,
  type DiscoveryStrategy
} from './discovery-strategy.js'
import { handleCloudflare } from '../utils/cloudflare.js'

export class LibraryDiscovery {
  private strategies: DiscoveryStrategy[]

  constructor() {
    const all = [
      new ApiDiscoveryStrategy(),
      new ScrollDiscoveryStrategy(),
      new InteractionDiscoveryStrategy(),
      new AiAssistedDiscoveryStrategy()
    ]

    const primaryMode = config.discoveryMode
    this.strategies = [
      all.find(s => s.constructor.name.toLowerCase().includes(primaryMode)) || all[0]!,
      ...all.filter(s => !s.constructor.name.toLowerCase().includes(primaryMode))
    ]
  }

  async discoverAllConversationsFromLibrary(page: Page): Promise<ConversationMetadata[]> {
    for (const strategy of this.strategies) {
      const strategyName = strategy.constructor.name
      try {
        logger.info(`Attempting discovery with strategy: ${strategyName}`)

        const result = await strategy.discover(page)
        const isBlocked = await handleCloudflare(page)

        if (isBlocked) {
          logger.warn(`Cloudflare detected after ${strategyName} attempt. Falling back...`)
          continue
        }

        if (result && result.length > 0) {
          logger.success(`Successfully discovered ${result.length} threads using ${strategyName}`)
          return result
        }
      } catch (e) {
        logger.error(`Strategy ${strategyName} failed. Checking for Cloudflare...`)
        const isBlocked = await handleCloudflare(page)
        if (isBlocked) {
          logger.warn(`Confirmed Cloudflare block for ${strategyName}. Trying next strategy...`)
          continue
        }
        logger.error(`Unexpected failure in ${strategyName}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    throw new Error('All discovery strategies failed or were blocked by Cloudflare.')
  }
}
