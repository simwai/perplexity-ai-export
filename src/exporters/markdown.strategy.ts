import type { ExportStrategy } from './export.strategy.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import type { Config } from '../utils/config.js'

const exporter: ExportStrategy = {
  name: 'markdown',
  fileExtension: '.md',
  outputDir(config: Config): string {
    return config.exportDir
  },
  format(conversation: ExtractedConversation): string {
    const headerTitle = `# ${conversation.title}\n\n`
    const metadataBlock =
      `**Space:** ${conversation.spaceName}  \n` +
      `**ID:** ${conversation.id}  \n` +
      `**Date:** ${conversation.timestamp.toISOString()}  \n\n`
    return headerTitle + metadataBlock + conversation.content
  },
}

export default exporter
