import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { type Config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export class FileWriter {
  static readonly WriteError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileWriteError'
    }
  }

  constructor(private readonly config: Config) {
    this.ensureRootExportDirectoryExists()
  }

  write(conversation: ExtractedConversation): string {
    try {
      const destinationFilePath = this.constructDestinationFilePath(conversation)
      const markdownContent = this.formatConversationAsMarkdown(conversation)

      this.ensureSpaceDirectoryExists(conversation.spaceName)

      writeFileSync(destinationFilePath, markdownContent, 'utf-8')
      return destinationFilePath
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FileWriter.WriteError(
        `Failed to write conversation ${conversation.id}: ${errorMessage}`
      )
    }
  }

  private ensureRootExportDirectoryExists(): void {
    if (!existsSync(this.config.exportDir)) {
      mkdirSync(this.config.exportDir, { recursive: true })
    }
  }

  private ensureSpaceDirectoryExists(spaceName: string): void {
    const spaceSpecificDirectory = join(this.config.exportDir, sanitizeSpaceName(spaceName))
    if (!existsSync(spaceSpecificDirectory)) {
      mkdirSync(spaceSpecificDirectory, { recursive: true })
    }
  }

  private constructDestinationFilePath(conversation: ExtractedConversation): string {
    const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
    const safeFileTitle = sanitizeFilename(conversation.title)
    const fileNameWithIdSuffix = `${safeFileTitle} (${conversation.id}).md`
    return join(this.config.exportDir, safeSpaceName, fileNameWithIdSuffix)
  }

  private formatConversationAsMarkdown(conversation: ExtractedConversation): string {
    const headerTitle = `# ${conversation.title}\n\n`
    const metadataBlock =
      `**Space:** ${conversation.spaceName}  \n` +
      `**ID:** ${conversation.id}  \n` +
      `**Date:** ${conversation.timestamp.toISOString()}  \n\n`
    return headerTitle + metadataBlock + conversation.content
  }
}
