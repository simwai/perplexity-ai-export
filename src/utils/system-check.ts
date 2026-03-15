import { statfsSync } from 'node:fs'
import { logger } from './logger.js'

export function ensureSystemRequirements(): void {
  try {
    const stats = statfsSync('.')
    const availableBytes = stats.bavail * stats.bsize
    const availableGb = availableBytes / (1024 * 1024 * 1024)

    if (availableGb < 10) {
      const msg = `CRITICAL: Insufficient disk space. You have only ${availableGb.toFixed(2)}GB available, but at least 10GB is required for AI models and temporary data.`
      logger.error(msg)
      throw new Error(msg)
    }

    logger.info(`Disk space check passed: ${availableGb.toFixed(2)}GB available.`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('CRITICAL')) throw error
    logger.warn('Unable to verify disk space, continuing anyway...')
  }
}
