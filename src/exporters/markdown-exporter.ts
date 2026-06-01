import type { ConversationExporter } from './exporter-interface.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import type { Config } from '../utils/config.js'

const exporter: ConversationExporter = {
  name: 'markdown',
  fileExtension: '.md',
  outputDir(config: Config): string {
    return config.exportDir
  },
  export(conversation: ExtractedConversation): string {
    const headerTitle = `# ${conversation.title}\n\n`
    const metadataBlock =
      `**Space:** ${conversation.spaceName}  \n` +
      `**ID:** ${conversation.id}  \n` +
      `**Date:** ${conversation.timestamp.toISOString()}  \n\n`
    return headerTitle + metadataBlock + conversation.content
  },
}

export default exporter
