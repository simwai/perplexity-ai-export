import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { type Config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'
import { type ExportStrategy } from '../exporters/export.strategy.js'
import { logger } from '../utils/logger.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { createResult, ok, err, type Result } from 'super-result'

async function readStrategyDefaultExport(filePath: string): Promise<ExportStrategy> {
  const moduleUrl = pathToFileURL(filePath).href
  const strategyModule = await import(moduleUrl)
  // why: dynamic import of strategy module; default export must match ExportStrategy interface
  const strategyModuleDefault = strategyModule.default
  if (!strategyModuleDefault || typeof strategyModuleDefault !== 'object') {
    throw new ExportError(`Strategy module missing default export: ${filePath}`)
  }
  return strategyModuleDefault as ExportStrategy
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export class ExportOrchestrator {
  static readonly ExportError = ExportError

  private readonly resultFactory = createResult<ExportError>((error: unknown) =>
    error instanceof ExportError ? error : new ExportError(String(error))
  )

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
        const filePath = join(strategiesDir, file)
        const strategy = await this.loadExportStrategy(filePath)
        if (!strategy) {
          continue
        }

        if (strategy.name && typeof strategy.format === 'function') {
          if (this.config.exportStrategies.includes(strategy.name)) {
            this.strategies.push(strategy)
            logger.debug(`Registered export strategy: ${strategy.name}`)
          }
        }
      }
    }
  }

  private async loadExportStrategy(filePath: string): Promise<ExportStrategy | undefined> {
    const importResult = await this.resultFactory.from(
      async () => await readStrategyDefaultExport(filePath)
    )

    if (!importResult.ok) {
      logger.error(
        `Failed to load export strategy ${filePath}: ${errorMessageOf(importResult.error)}`
      )
      return undefined
    }

    return importResult.value
  }

  async exportConversation(
    conversation: ExtractedConversation
  ): Promise<Result<string[], ExportError>> {
    const writtenFiles: string[] = []

    for (const strategy of this.strategies) {
      const outputDir = strategy.outputDir(this.config)
      const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
      const spaceSpecificDirectory = join(outputDir, safeSpaceName)

      if (!existsSync(spaceSpecificDirectory)) {
        const mkdirResult = this.resultFactory.from(() =>
          mkdirSync(spaceSpecificDirectory, { recursive: true })
        )
        if (!mkdirResult.ok) {
          logger.error(
            `Failed to create directory for ${strategy.name} for ${conversation.id}: ${errorMessageOf(mkdirResult.error)}`
          )
          continue
        }
      }

      const safeFileTitle = sanitizeFilename(conversation.title)
      const fileName = `${safeFileTitle} (${conversation.id})${strategy.fileExtension}`
      const destinationFilePath = join(spaceSpecificDirectory, fileName)

      this.cleanupStaleFiles(conversation.id, destinationFilePath, strategy.fileExtension)

      const content = strategy.format(conversation)
      const writeResult = this.resultFactory.from(() =>
        writeFileSync(destinationFilePath, content, 'utf-8')
      )
      if (!writeResult.ok) {
        logger.error(
          `Failed to export with ${strategy.name} for ${conversation.id}: ${errorMessageOf(writeResult.error)}`
        )
        continue
      }

      const verifyResult = this.resultFactory.from(() =>
        this.verifyExportedFile(destinationFilePath)
      )
      if (!verifyResult.ok) {
        logger.error(
          `Failed to export with ${strategy.name} for ${conversation.id}: ${errorMessageOf(verifyResult.error)}`
        )
        continue
      }

      writtenFiles.push(destinationFilePath)
    }

    if (writtenFiles.length === 0 && this.strategies.length > 0) {
      return err(
        new ExportOrchestrator.ExportError(
          `Failed to write conversation ${conversation.id} with any strategy.`
        )
      )
    }

    return ok(writtenFiles)
  }

  private ensureRootExportDirectoryExists(): void {
    if (!existsSync(this.config.exportDir)) {
      const mkdirResult = this.resultFactory.from(() =>
        mkdirSync(this.config.exportDir, { recursive: true })
      )
      if (!mkdirResult.ok) {
        logger.error(
          `Failed to create export directory ${this.config.exportDir}: ${errorMessageOf(mkdirResult.error)}`
        )
      }
    }
  }

  private cleanupStaleFiles(
    conversationId: string,
    currentFilePath: string,
    fileExtension: string
  ): void {
    const suffix = `(${conversationId})${fileExtension}`
    const searchDirs = new Set<string>([this.config.exportDir])

    for (const strategy of this.strategies) {
      searchDirs.add(strategy.outputDir(this.config))
    }

    for (const baseDir of searchDirs) {
      if (!existsSync(baseDir)) continue
      for (const staleFile of this.findFilesBySuffix(baseDir, suffix)) {
        if (staleFile !== currentFilePath) {
          const unlinkResult = this.resultFactory.from(() => unlinkSync(staleFile))
          if (unlinkResult.ok) {
            logger.debug(`Cleaned up stale export: ${staleFile}`)
          } else {
            logger.debug(
              `Failed to clean up stale export ${staleFile}: ${errorMessageOf(unlinkResult.error)}`
            )
          }
        }
      }
    }
  }

  private findFilesBySuffix(baseDir: string, suffix: string): string[] {
    const results: string[] = []

    const scanDirectory = (dir: string): void => {
      const readDirResult = this.resultFactory.from(() => readdirSync(dir))
      if (!readDirResult.ok) {
        // why: directory may be missing or unreadable mid-walk; treat as empty
        return
      }

      const entries = readDirResult.value
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const statResult = this.resultFactory.from(() => statSync(fullPath))
        if (!statResult.ok) {
          // why: entry may be a broken symlink or transient FS race; skip
          continue
        }

        if (statResult.value.isDirectory()) {
          scanDirectory(fullPath)
        } else if (entry.endsWith(suffix)) {
          results.push(fullPath)
        }
      }
    }

    scanDirectory(baseDir)
    return results
  }

  private verifyExportedFile(destinationFilePath: string): Result<void, ExportError> {
    if (!existsSync(destinationFilePath) || statSync(destinationFilePath).size === 0) {
      return err(
        new ExportOrchestrator.ExportError(
          `Exported file is missing or empty: ${destinationFilePath}`
        )
      )
    }
    return ok(undefined)
  }
}
