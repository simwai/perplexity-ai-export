import { BaseHandler } from './base.js'
import { confirm } from '@inquirer/prompts'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'
import { rmSync, existsSync } from 'node:fs'
import { sep } from 'node:path'

export class MaintenanceHandler extends BaseHandler {
  async handleDataReset(): Promise<void> {
    try {
      const isUserCertainOfReset = await confirm({
        message: '⚠️ This will delete all stored checkpoints, authentication data, and vector index. Are you sure?',
        default: false
      })

      if (!isUserCertainOfReset) {
        return
      }

      this.wipeStorageDirectory()
      this.checkpointManager.resetCheckpoint()
      logger.success('✅ Storage folder deleted. All progress has been reset.')
    } catch (resetError) {
      errorBus.emitError('Reset failed', resetError)
    }
  }

  private wipeStorageDirectory(): void {
    const authenticationStoragePath = this.applicationConfig.authStoragePath
    const storageRootDirectory = authenticationStoragePath ? authenticationStoragePath.split(sep)[0] : '.storage'

    if (storageRootDirectory && existsSync(storageRootDirectory)) {
      try {
        rmSync(storageRootDirectory, { recursive: true, force: true })
      } catch (deletionError) {
        errorBus.raiseError(`Failed to delete storage directory: ${storageRootDirectory}`, deletionError)
      }
    }
  }
}
