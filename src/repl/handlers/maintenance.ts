import { BaseHandler } from './base.js'
import { confirm } from '@inquirer/prompts'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'
import { rmSync, existsSync } from 'node:fs'
import { sep } from 'node:path'

export class MaintenanceHandler extends BaseHandler {
  async handleDataReset(): Promise<void> {
    const certain = await confirm({
      message: '⚠️ This will delete all stored checkpoints, authentication data, and vector index. Are you sure?',
      default: false
    })
    if (!certain) return

    try {
      this.wipeStorage()
      this.checkpointManager.resetCheckpoint()
      logger.success('✅ Storage folder deleted. All progress has been reset.')
    } catch (error) {
      errorBus.emitError('Failed to reset', error)
    }
  }

  private wipeStorage(): void {
    const authPath = this.config.authStoragePath
    const storageRoot = authPath ? authPath.split(sep)[0] : '.storage'
    if (storageRoot && existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }
}
