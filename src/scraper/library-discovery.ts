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
      try {
        const strategyName = strategy.constructor.name
        logger.info(`Attempting discovery with strategy: ${strategyName}`)

        const result = await strategy.discover(page)
        const isBlocked = await handleCloudflare(page)

        if (isBlocked) {
          logger.warn(`Cloudflare blocked ${strategyName}. Retrying with next available strategy...`)
          continue
        }

        if (result && result.length > 0) {
          logger.success(`Successfully discovered ${result.length} threads using ${strategyName}`)
          return result
        } else {
          logger.warn(`${strategyName} returned no results. Trying fallback...`)
        }
      } catch (e) {
        logger.error(`Strategy failure (${strategy.constructor.name}): ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    throw new Error('All discovery strategies failed to retrieve library content or were blocked by Cloudflare.')
  }
}
