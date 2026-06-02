export interface ExtractedConversation {
  conversationId: string
  conversationTitle: string
  conversationSpaceName: string
  extractionTimestamp: Date
  formattedMarkdownContent: string
  contentIntegrityHash: string
}
