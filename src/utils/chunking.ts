export function chunkMarkdown(text: string, size = 1500, overlap = 100): string[] {
  if (!text) return []

  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + size
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end)
      if (lastNewline > start) {
        end = lastNewline
      }
    }
    chunks.push(text.substring(start, end).trim())

    // Ensure we actually progress
    const nextStart = end - overlap
    if (nextStart <= start) {
      start = end // Force progress if overlap is too large
    } else {
      start = nextStart
    }

    if (start >= text.length) break
  }
  return chunks
}
