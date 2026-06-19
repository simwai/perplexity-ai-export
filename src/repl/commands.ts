import { CheckpointManager } from '../scraper/checkpoint-manager.js'
import { SearchOrchestrator } from '../search/search-orchestrator.js'
import { showHelp } from './help.js'
import { type Config } from '../utils/config.js'
import { ExportHandler } from './handlers/export.js'
import { SearchHandler } from './handlers/search.js'
import { MaintenanceHandler } from './handlers/maintenance.js'

export class CommandHandler {
  private readonly libraryExportHandler: ExportHandler
  private readonly conversationSearchHandler: SearchHandler
  private readonly systemMaintenanceHandler: MaintenanceHandler

  constructor(applicationConfig: Config) {
    const activeCheckpointManager = new CheckpointManager(applicationConfig)
    const activeSearchOrchestrator = new SearchOrchestrator(applicationConfig)

    this.libraryExportHandler = new ExportHandler(
      applicationConfig,
      activeCheckpointManager,
      activeSearchOrchestrator
    )
    this.conversationSearchHandler = new SearchHandler(
      applicationConfig,
      activeCheckpointManager,
      activeSearchOrchestrator
    )
    this.systemMaintenanceHandler = new MaintenanceHandler(
      applicationConfig,
      activeCheckpointManager,
      activeSearchOrchestrator
    )
  }

  async handleScraperWizard(): Promise<void> {
    await this.libraryExportHandler.handleScraperWizard()
  }

  async handleSearchWizard(): Promise<void> {
    await this.conversationSearchHandler.handleSearchWizard()
  }

  async handleVectorizeWizard(): Promise<void> {
    await this.conversationSearchHandler.handleVectorizeWizard()
  }

  async handleDataReset(): Promise<void> {
    await this.systemMaintenanceHandler.handleDataReset()
  }

  handleShowHelp(): void {
    showHelp()
  }
}
