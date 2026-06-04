import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { type Config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'
import { type ExportStrategy } from '../exporters/export.strategy.js'
import { logger } from '../utils/logger.js'

export class ExportOrchestrator {
  static readonly WriteError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileWriteError'
    }
  }

  private strategies: ExportStrategy[] = []

  constructor(private readonly config: Config) {
    this.ensureRootExportDirectoryExists()
  }

  async initialize(): Promise<void> {
    await this.initializeStrategies()
  }

  private async initializeStrategies(): Promise<void> {
    const strategiesDir = join(import.meta.dirname, '..', 'exporters')

    if (!existsSync(strategiesDir)) {
      logger.warn(`Exporters directory not found: ${strategiesDir}`)
      return
    }

    const files = readdirSync(strategiesDir)
    for (const file of files) {
      if (
        (file.endsWith('.strategy.ts') || file.endsWith('.strategy.js')) &&
        !file.endsWith('.d.ts')
      ) {
        try {
          const filePath = join(strategiesDir, file)
          const moduleUrl = pathToFileURL(filePath).href
          const strategyModule = await import(moduleUrl)
          const strategy = strategyModule.default as ExportStrategy

          if (strategy && strategy.name && typeof strategy.format === 'function') {
            if (this.config.exportStrategies.includes(strategy.name)) {
              this.strategies.push(strategy)
              logger.debug(`Registered export strategy: ${strategy.name}`)
            }
          }
        } catch (error) {
          logger.error(`Failed to load export strategy ${file}: ${error}`)
        }
      }
    }

    if (this.strategies.length === 0) {
      logger.warn('No active export strategies found. Defaulting to markdown.')
      try {
        const markdownStrategy = (await import('../exporters/markdown.strategy.js')).default
        this.strategies.push(markdownStrategy)
      } catch (e) {
        logger.error('Failed to load default markdown strategy', e)
      }
    }
  }

  async exportConversation(conversation: ExtractedConversation): Promise<string[]> {
    const writtenFiles: string[] = []

    for (const strategy of this.strategies) {
      try {
        const outputDir = strategy.outputDir(this.config)
        const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
        const spaceSpecificDirectory = join(outputDir, safeSpaceName)

        if (!existsSync(spaceSpecificDirectory)) {
          mkdirSync(spaceSpecificDirectory, { recursive: true })
        }

        const safeFileTitle = sanitizeFilename(conversation.title)
        const fileName = `${safeFileTitle} (${conversation.id})${strategy.fileExtension}`
        const destinationFilePath = join(spaceSpecificDirectory, fileName)

        const content = strategy.format(conversation)
        writeFileSync(destinationFilePath, content, 'utf-8')

        if (!existsSync(destinationFilePath) || statSync(destinationFilePath).size === 0) {
          throw new Error(`Exported file is missing or empty: ${destinationFilePath}`)
        }

        writtenFiles.push(destinationFilePath)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(
          `Failed to export with ${strategy.name} for ${conversation.id}: ${errorMessage}`
        )
      }
    }

    if (writtenFiles.length === 0 && this.strategies.length > 0) {
      throw new ExportOrchestrator.WriteError(
        `Failed to write conversation ${conversation.id} with any strategy.`
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
