export class MarkdownFormatter {
  format(conversationEntries: any[], conversationThreadTitle: string): string {
    let resultMarkdownText = ''

    for (let entryIndex = 0; entryIndex < conversationEntries.length; entryIndex++) {
      const currentEntry = conversationEntries[entryIndex]
      const questionText = currentEntry.query_str ?? (entryIndex === 0 ? conversationThreadTitle : 'Follow-up')

      let answerContentText = ''
      for (const contentBlock of currentEntry.blocks ?? []) {
        if (contentBlock.markdown_block?.answer) {
          answerContentText += contentBlock.markdown_block.answer + '\n\n'
        }
      }

      if (questionText) {
        resultMarkdownText += `## ${questionText}\n\n`
      }
      if (answerContentText) {
        resultMarkdownText += `${answerContentText.trim()}\n\n`
      }

      const horizontalRuleSeparator = '---\n\n'
      resultMarkdownText += horizontalRuleSeparator
    }

    return resultMarkdownText.trim()
  }
}
