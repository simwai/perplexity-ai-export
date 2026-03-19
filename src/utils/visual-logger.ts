import type { Page } from 'patchright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import { logger } from './logger.js'

const DEBUG_DIR = 'debug_screenshots'

export class VisualLogger {
  private static sequence = 0

  static async captureAction(
    page: Page,
    name: string,
    clickX?: number,
    clickY?: number
  ): Promise<string | null> {
    try {
      if (!existsSync(DEBUG_DIR)) {
        mkdirSync(DEBUG_DIR, { recursive: true })
      }

      this.sequence++
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const baseFilename = `${this.sequence.toString().padStart(3, '0')}_${name}_${timestamp}`
      const rawPath = join(DEBUG_DIR, `${baseFilename}_raw.jpg`)

      // 1. Take the base screenshot
      const buffer = await page.screenshot({ type: 'jpeg', quality: 80 })
      writeFileSync(rawPath, buffer)

      if (clickX !== undefined && clickY !== undefined) {
        const markerPath = join(DEBUG_DIR, `${baseFilename}_marker.jpg`)

        // 2. Draw marker using Jimp
        const image = await Jimp.read(buffer)

        // Draw a red crosshair (X)
        const size = 20
        const color = 0xFF0000FF // Red

        // Horizontal line
        for (let i = -size; i <= size; i++) {
          const px = Math.floor(clickX + i)
          const py = Math.floor(clickY)
          if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
            image.setPixelColor(color, px, py)
          }
        }

        // Vertical line
        for (let i = -size; i <= size; i++) {
          const px = Math.floor(clickX)
          const py = Math.floor(clickY + i)
          if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
            image.setPixelColor(color, px, py)
          }
        }

        const markedBuffer = await image.getBuffer('image/jpeg')
        writeFileSync(markerPath, markedBuffer)
        logger.debug(`Visual log saved: ${markerPath}`)
        return markerPath
      }

      logger.debug(`Visual log saved: ${rawPath}`)
      return rawPath
    } catch (e) {
      logger.warn(`Failed to capture visual log: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  static reset(): void {
    this.sequence = 0
  }
}
