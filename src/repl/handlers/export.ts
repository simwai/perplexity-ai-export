import { BaseHandler } from './base.js'
import { BrowserManager } from '../../scraper/browser.js'
import { LibraryDiscovery } from '../../scraper/library-discovery.js'
import { WorkerPool } from '../../scraper/worker-pool.js'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'
import { select } from '@inquirer/prompts'

export class ExportHandler extends BaseHandler {
  async handleScraperWizard(): Promise<void> {
    const progress = this.checkpointManager.getProcessingProgress()
    if (progress.total > 0) {
      await this.promptUserForCheckpointAction()
    }
    await this.handleStartLibraryExport()
  }

  async handleStartLibraryExport(): Promise<void> {
    const browserManager = new BrowserManager(this.config)
    try {
      const activePage = await browserManager.launch()

      if (!this.checkpointManager.isDiscoveryPhaseComplete()) {
        logger.info('\n=== Phase 1: Library Discovery ===\n')
        const discoveryTool = new LibraryDiscovery()
        const discovered = await discoveryTool.discoverAllConversationsFromLibrary(activePage)
        this.checkpointManager.setDiscoveredConversations(discovered)
      }

      const pending = this.checkpointManager.getPendingConversations()
      if (pending.length === 0) {
        logger.success('All conversations already processed!')
        return
      }

      logger.info(`\n=== Phase 2: Parallel Extraction (${pending.length} pending) ===\n`)
      const activeBrowser = browserManager.browserInstance!
      const workerPool = new WorkerPool(this.config, this.checkpointManager, activeBrowser)
      await workerPool.initialize()
      await workerPool.processConversations(pending)
      await workerPool.close()

      logger.success('\n✨ Export complete!')
    } catch (error) {
      errorBus.emitError('Scraper failed', error)
    } finally {
      await browserManager.close()
    }
  }

  private async promptUserForCheckpointAction(): Promise<void> {
    const currentProgress = this.checkpointManager.getProcessingProgress()
    const selectedAction = await select({
      message: `Found checkpoint (${currentProgress.processed}/${currentProgress.total} processed). What do you want to do?`,
      choices: [
        { name: 'Resume (Continue processing known threads)', value: 'resume' },
        { name: 'Sync (Re-scan library for new threads and updates)', value: 'update' },
        { name: 'Start Over (Re-scan and re-process everything)', value: 'restart' },
        { name: 'Cancel', value: 'cancel' },
      ],
    })

    if (selectedAction === 'cancel') {
      logger.info('Start cancelled.')
      process.exit(0)
    }
    if (selectedAction === 'restart') this.checkpointManager.resetCheckpoint()
    else if (selectedAction === 'update') this.checkpointManager.prepareForUpdateRun()
  }
}
