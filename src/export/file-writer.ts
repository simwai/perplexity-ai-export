import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export interface WrittenConversationFiles {
  primaryPath: string
  structuredJsonPath?: string
  markdownPath?: string
}

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

  write(conversation: ExtractedConversation): WrittenConversationFiles {
    try {
      if (!config.exportStructuredJson && !config.exportMarkdown) {
        throw new FileWriter.WriteError(
          'No export formats enabled. Enable EXPORT_STRUCTURED_JSON or EXPORT_MARKDOWN.'
        )
      }

      const writtenFiles: Partial<WrittenConversationFiles> = {}

      if (config.exportStructuredJson) {
        const structuredJsonPath = this.constructStructuredJsonPath(conversation)
        this.ensureSpaceDirectoryExists(config.structuredExportDir, conversation.spaceName)
        writeFileSync(
          structuredJsonPath,
          JSON.stringify(this.formatConversationAsStructuredJson(conversation), null, 2),
          'utf-8'
        )
        writtenFiles.structuredJsonPath = structuredJsonPath
        writtenFiles.primaryPath = structuredJsonPath
      }

      if (config.exportMarkdown) {
        const markdownPath = this.constructMarkdownPath(conversation)
        const markdownContent = this.formatConversationAsMarkdown(conversation)
        this.ensureSpaceDirectoryExists(config.exportDir, conversation.spaceName)
        writeFileSync(markdownPath, markdownContent, 'utf-8')
        writtenFiles.markdownPath = markdownPath
        writtenFiles.primaryPath ??= markdownPath
      }

      return writtenFiles as WrittenConversationFiles
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
    if (!existsSync(config.structuredExportDir)) {
      mkdirSync(config.structuredExportDir, { recursive: true })
    }
  }

  private ensureSpaceDirectoryExists(rootDirectory: string, spaceName: string): void {
    const spaceSpecificDirectory = join(rootDirectory, sanitizeSpaceName(spaceName))
    if (!existsSync(spaceSpecificDirectory)) {
      mkdirSync(spaceSpecificDirectory, { recursive: true })
    }
  }

  private constructMarkdownPath(conversation: ExtractedConversation): string {
    const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
    const safeFileTitle = sanitizeFilename(conversation.title)
    const fileNameWithId = `${safeFileTitle} (${conversation.id}).md`
    return join(config.exportDir, safeSpaceName, fileNameWithId)
  }

  private constructStructuredJsonPath(conversation: ExtractedConversation): string {
    const safeSpaceName = sanitizeSpaceName(conversation.spaceName)
    const safeFileTitle = sanitizeFilename(conversation.title)
    const fileNameWithId = `${safeFileTitle} (${conversation.id}).itir.perplexity.json`
    return join(config.structuredExportDir, safeSpaceName, fileNameWithId)
  }

  private formatConversationAsStructuredJson(conversation: ExtractedConversation): unknown {
    return {
      schema: 'itir.perplexity.thread.v1',
      source: 'perplexity',
      source_thread_id: conversation.id,
      url: conversation.url,
      title: conversation.title,
      space: conversation.spaceName,
      updated_at: conversation.timestamp.toISOString(),
      exported_at: new Date().toISOString(),
      messages: conversation.messages.map((message) => ({
        role: message.role,
        content: message.content,
        source_message_id: message.id,
        created_at: conversation.timestamp.toISOString(),
        turn_index: message.entryIndex,
        provenance: {
          thread_id: conversation.id,
          entry_index: message.entryIndex,
          message_index: message.index,
        },
      })),
      markdown: conversation.content,
      raw: {
        api_response: conversation.rawApiResponse,
        entries: conversation.rawEntries,
      },
    }
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
