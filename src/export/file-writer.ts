import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export class FileWriter {
  static readonly WriteError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileWriteError'
    }
  }

  constructor() {
    this.ensureRootExportDirectoryExists()
  }

  write(conversation: ExtractedConversation): string {
    try {
      const destinationFilePath = this.constructDestinationFilePath(conversation)
      const markdownContent = this.formatConversationAsMarkdown(conversation)

      const spaceSpecificDirectory = join(
        config.exportDir,
        sanitizeSpaceName(conversation.spaceName)
      )
      if (!existsSync(spaceSpecificDirectory)) {
        mkdirSync(spaceSpecificDirectory, { recursive: true })
      }

      writeFileSync(destinationFilePath, markdownContent, 'utf-8')
      return destinationFilePath
    } catch (error) {
      throw new FileWriter.WriteError(
        `Failed to write conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private ensureRootExportDirectoryExists(): void {
    if (!existsSync(config.exportDir)) {
      mkdirSync(config.exportDir, { recursive: true })
    }
  }

  private constructDestinationFilePath(conversation: ExtractedConversation): string {
    const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
    const safeFileTitle = sanitizeFilename(conversation.title)
    const fileNameWithId = `${safeFileTitle} (${conversation.id}).md`
    return join(config.exportDir, safeSpaceName, fileNameWithId)
  }

  private formatConversationAsMarkdown(conversation: ExtractedConversation): string {
    const header = `# ${conversation.title}\n\n`
    const metadata =
      `**Space:** ${conversation.spaceName}  \n` +
      `**ID:** ${conversation.id}  \n` +
      `**Date:** ${conversation.timestamp.toISOString()}  \n\n`
    return header + metadata + conversation.content
  }
}
