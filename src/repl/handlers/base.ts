import { type Config } from '../../utils/config.js'
import { type CheckpointManager } from '../../scraper/checkpoint-manager.js'
import { type SearchOrchestrator } from '../../search/search-orchestrator.js'

export abstract class BaseHandler {
  constructor(
    protected readonly applicationConfig: Config,
    protected readonly checkpointManager: CheckpointManager,
    protected readonly searchOrchestrator: SearchOrchestrator
  ) {}
}
