import { CheckpointManager } from '../scraper/checkpoint-manager.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { showHelp } from './help.js'
import { type Config } from '../utils/config.js'
import { ExportHandler } from './handlers/export.js'
import { SearchHandler } from './handlers/search.js'
import { MaintenanceHandler } from './handlers/maintenance.js'

export class CommandHandler {
  private readonly exportHandler: ExportHandler
  private readonly searchHandler: SearchHandler
  private readonly maintenanceHandler: MaintenanceHandler

  constructor(config: Config) {
    const checkpointManager = new CheckpointManager(config)
    const searchOrchestrator = new SearchOrchestrator(config)

    this.exportHandler = new ExportHandler(config, checkpointManager, searchOrchestrator)
    this.searchHandler = new SearchHandler(config, checkpointManager, searchOrchestrator)
    this.maintenanceHandler = new MaintenanceHandler(config, checkpointManager, searchOrchestrator)
  }

  async handleScraperWizard(): Promise<void> {
    await this.exportHandler.handleScraperWizard()
  }

  async handleSearchWizard(): Promise<void> {
    await this.searchHandler.handleSearchWizard()
  }

  async handleVectorizeWizard(): Promise<void> {
    await this.searchHandler.handleVectorizeWizard()
  }

  async handleDataReset(): Promise<void> {
    await this.maintenanceHandler.handleDataReset()
  }

  handleShowHelp(): void {
    showHelp()
  }
}
