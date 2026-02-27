import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export class FileWriter {
  constructor() {
    this.ensureExportDir()
  }

  private ensureExportDir(): void {
    if (!existsSync(config.exportDir)) {
      mkdirSync(config.exportDir, { recursive: true })
    }
  }

  write(conversation: ExtractedConversation): string {
    // Sanitize parts
    const safeTitle = sanitizeFilename(conversation.title)
    const safeSpace = sanitizeSpaceName(conversation.spaceName)

    // Create space subdirectory (Optional, but nice for organization)
    const spaceDir = join(config.exportDir, safeSpace)
    if (!existsSync(spaceDir)) {
      mkdirSync(spaceDir, { recursive: true })
    }

    // FIX: Include ID in filename to prevent overwrites on duplicate titles
    // Format: "Title_Shortened (ID).md"
    const filename = `${safeTitle} (${conversation.id}).md`
    const filepath = join(spaceDir, filename)

    const fileContent = this.formatContent(conversation)

    writeFileSync(filepath, fileContent, 'utf-8')
    return filepath
  }

  private formatContent(conv: ExtractedConversation): string {
    return (
      `# ${conv.title}\n\n` +
      `Space: ${conv.spaceName}\n` +
      `ID: ${conv.id}\n` + // <--- Useful for debugging
      `Date: ${conv.timestamp.toISOString()}\n\n` +
      `${conv.content}`
    )
  }
}
