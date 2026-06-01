import { join, dirname } from 'node:path'
import fs from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import { type Config } from '../utils/config.js'
import { type ExtractedConversation } from '../scraper/extractor/types.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export class FileWriter {
  constructor(private readonly config: Config) {}

  async write(conversation: ExtractedConversation): Promise<string> {
    const dest = this.constructPath(conversation)
    const content = this.formatMd(conversation)

    await fs.mkdir(dirname(dest), { recursive: true })
    await (writeFileAtomic as any)(dest, content, 'utf8')
    return dest
  }

  private constructPath(c: ExtractedConversation): string {
    const safeSpace = sanitizeSpaceName(c.spaceName)
    const safeTitle = sanitizeFilename(c.title)
    return join(this.config.exportDir, safeSpace, `${safeTitle} (${c.id}).md`)
  }

  private formatMd(c: ExtractedConversation): string {
    return `# ${c.title}\n\n` +
      `**Space:** ${c.spaceName}  \n` +
      `**ID:** ${c.id}  \n` +
      `**Date:** ${c.timestamp.toISOString()}  \n\n` +
      c.content
  }
}
