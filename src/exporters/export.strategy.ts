import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import type { Config } from '../utils/config.js'

export interface ExportStrategy {
  /** Must match exactly what you put in EXPORT_STRATEGIES */
  name: string
  fileExtension: string
  /** Where to write output files. Return config.exportDir as the safe default. */
  outputDir(config: Config): string
  /** Serialize the conversation. Return a string (UTF-8). */
  format(conversation: ExtractedConversation): string
}
