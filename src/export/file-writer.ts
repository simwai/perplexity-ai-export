import { join, dirname } from 'node:path'
import fileSystem from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import { type Config } from '../utils/config.js'
import { type ExtractedConversation } from '../scraper/extractor/types.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'
import { errorBus } from '../utils/error-bus.js'

export class FileWriter {
  constructor(private readonly applicationConfig: Config) {}

  async write(extractedConversation: ExtractedConversation): Promise<string> {
    try {
      const destinationFilePath = this.constructDestinationPath(extractedConversation)
      const formattedMarkdownContent = this.formatAsMarkdown(extractedConversation)

      await fileSystem.mkdir(dirname(destinationFilePath), { recursive: true })
      await (writeFileAtomic as any)(destinationFilePath, formattedMarkdownContent, 'utf8')
      return destinationFilePath
    } catch (writeError) {
      return errorBus.raiseError(`Failed to write conversation ${extractedConversation.conversationId}`, writeError)
    }
  }

  private constructDestinationPath(extractedConversation: ExtractedConversation): string {
    const safeSpaceName = sanitizeSpaceName(extractedConversation.conversationSpaceName)
    const safeTitle = sanitizeFilename(extractedConversation.conversationTitle)
    const filenameWithIdSuffix = `${safeTitle} (${extractedConversation.conversationId}).md`
    return join(this.applicationConfig.exportDir, safeSpaceName, filenameWithIdSuffix)
  }

  private formatAsMarkdown(extractedConversation: ExtractedConversation): string {
    const headerTitle = `# ${extractedConversation.conversationTitle}\n\n`
    const metadataBlock =
      `**Space:** ${extractedConversation.conversationSpaceName}  \n` +
      `**ID:** ${extractedConversation.conversationId}  \n` +
      `**Date:** ${extractedConversation.extractionTimestamp.toISOString()}  \n\n`
    return headerTitle + metadataBlock + extractedConversation.formattedMarkdownContent
  }
}
