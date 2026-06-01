export class MarkdownFormatter {
  format(entries: any[], title: string): string {
    let md = ''
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const question = e.query_str ?? (i === 0 ? title : 'Follow-up')
      let answer = ''
      for (const b of e.blocks ?? []) {
        if (b.markdown_block?.answer) answer += b.markdown_block.answer + '\n\n'
      }
      if (question) md += `## ${question}\n\n`
      if (answer) md += `${answer.trim()}\n\n`
      md += '---\n\n'
    }
    return md.trim()
  }
}
