import { BaseHandler } from './base.js'
import { BrowserManager } from '../../scraper/browser.js'
import { LibraryDiscovery } from '../../scraper/library-discovery.js'
import { WorkerPool } from '../../scraper/worker-pool.js'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'
import { select } from '@inquirer/prompts'

export class ExportHandler extends BaseHandler {
  async handleScraperWizard(): Promise<void> {
    const processingProgress = this.checkpointManager.getProcessingProgress()
    const hasExistingProgress = processingProgress.total > 0

    if (hasExistingProgress) {
      await this.promptUserForCheckpointAction()
    }
    await this.handleStartLibraryExport()
  }

  async handleStartLibraryExport(): Promise<void> {
    const browserManager = new BrowserManager(this.applicationConfig)
    try {
      const activeBrowserPage = await browserManager.launch()

      const isDiscoveryPhaseRequired = !this.checkpointManager.isDiscoveryPhaseComplete()
      if (isDiscoveryPhaseRequired) {
        logger.info('\n=== Phase 1: Library Discovery ===\n')
        const libraryDiscoveryTool = new LibraryDiscovery()
        const discoveredConversations =
          await libraryDiscoveryTool.discoverAllConversationsFromLibrary(activeBrowserPage)
        this.checkpointManager.setDiscoveredConversations(discoveredConversations)
      }

      const pendingConversationsToExtract = this.checkpointManager.getPendingConversations()
      const hasPendingConversations = pendingConversationsToExtract.length > 0

      if (!hasPendingConversations) {
        logger.success('All conversations already processed!')
        return
      }

      logger.info(
        `\n=== Phase 2: Parallel Extraction (${pendingConversationsToExtract.length} pending) ===\n`
      )
      const launchedBrowserInstance = browserManager.browserInstance!
      const extractionWorkerPool = new WorkerPool(
        this.applicationConfig,
        this.checkpointManager,
        launchedBrowserInstance
      )

      await extractionWorkerPool.initialize()
      await extractionWorkerPool.processConversations(pendingConversationsToExtract)
      await extractionWorkerPool.close()

      logger.success('\n✨ Export complete!')
    } catch (scrapingError) {
      errorBus.emitError('Scraper failed', scrapingError)
    } finally {
      await browserManager.close()
    }
  }

  private async promptUserForCheckpointAction(): Promise<void> {
    const currentProgress = this.checkpointManager.getProcessingProgress()
    const userSelectedAction = await select({
      message: `Found checkpoint (${currentProgress.processed}/${currentProgress.total} processed). What do you want to do?`,
      choices: [
        { name: 'Resume (Continue processing known threads)', value: 'resume' },
        { name: 'Sync (Re-scan library for new threads and updates)', value: 'update' },
        { name: 'Start Over (Re-scan and re-process everything)', value: 'restart' },
        { name: 'Cancel', value: 'cancel' },
      ],
    })

    if (userSelectedAction === 'cancel') {
      logger.info('Start cancelled.')
      process.exit(0)
    }

    if (userSelectedAction === 'restart') {
      this.checkpointManager.resetCheckpoint()
    } else if (userSelectedAction === 'update') {
      this.checkpointManager.prepareForUpdateRun()
    }
  }
}
