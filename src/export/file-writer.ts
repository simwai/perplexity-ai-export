import { join, dirname } from 'node:path'
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'
import { type ConversationExporter } from '../exporters/exporter-interface.js'
import { logger } from '../utils/logger.js'

export class FileWriter {
  static readonly WriteError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileWriteError'
    }
  }

  private exporters: ConversationExporter[] = []

  constructor(private readonly config: Config) {
    this.ensureRootExportDirectoryExists()
  }

  async initialize(): Promise<void> {
    await this.discoverExporters()
  }

  private async discoverExporters(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const exportersDir = join(__dirname, '..', 'exporters')

    if (!existsSync(exportersDir)) {
      logger.warn(`Exporters directory not found: ${exportersDir}`)
      return
    }

    const files = readdirSync(exportersDir)
    for (const file of files) {
      if (
        (file.endsWith('-exporter.ts') || file.endsWith('-exporter.js')) &&
        !file.endsWith('.d.ts')
      ) {
        try {
          const filePath = join(exportersDir, file)
          const moduleUrl = pathToFileURL(filePath).href
          const module = await import(moduleUrl)
          const exporter = module.default as ConversationExporter

          if (exporter && exporter.name && typeof exporter.export === 'function') {
            if (this.config.enabledExporters.includes(exporter.name)) {
              this.exporters.push(exporter)
              logger.debug(`Registered exporter: ${exporter.name}`)
            }
          }
        } catch (error) {
          logger.error(`Failed to load exporter ${file}: ${error}`)
        }
      }
    }

    if (this.exporters.length === 0) {
      logger.warn('No active exporters found. Defaulting to markdown.')
      // Manual fallback if discovery fails or nothing matches
      try {
        const markdownExporter = (await import('../exporters/markdown-exporter.js')).default
        this.exporters.push(markdownExporter)
      } catch (e) {
        logger.error('Failed to load default markdown exporter', e)
      }
    }
  }

  async write(conversation: ExtractedConversation): Promise<string[]> {
    const writtenFiles: string[] = []

    for (const exporter of this.exporters) {
      try {
        const outputDir = exporter.outputDir(this.config)
        const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
        const spaceSpecificDirectory = join(outputDir, safeSpaceName)

        if (!existsSync(spaceSpecificDirectory)) {
          mkdirSync(spaceSpecificDirectory, { recursive: true })
        }

        const safeFileTitle = sanitizeFilename(conversation.title)
        const fileName = `${safeFileTitle} (${conversation.id})${exporter.fileExtension}`
        const destinationFilePath = join(spaceSpecificDirectory, fileName)

        const content = exporter.export(conversation)
        writeFileSync(destinationFilePath, content, 'utf-8')

        // Integrity check
        if (!existsSync(destinationFilePath) || statSync(destinationFilePath).size === 0) {
          throw new Error(`Exported file is missing or empty: ${destinationFilePath}`)
        }

        writtenFiles.push(destinationFilePath)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to export with ${exporter.name} for ${conversation.id}: ${errorMessage}`)
      }
    }

    if (writtenFiles.length === 0 && this.exporters.length > 0) {
      throw new FileWriter.WriteError(
        `Failed to write conversation ${conversation.id} with any exporter.`
      )
    }

    return writtenFiles
  }

  private ensureRootExportDirectoryExists(): void {
    if (!existsSync(this.config.exportDir)) {
      mkdirSync(this.config.exportDir, { recursive: true })
    }
  }
}
