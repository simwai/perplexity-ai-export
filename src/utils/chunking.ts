/**
 * Splits Markdown text into semantic chunks to fit context windows.
 * Handles standard headers (#) AND horizontal rules (---) used in Perplexity exports.
 */
export function chunkMarkdown(markdown: string, maxChars = 1500, overlap = 150): string[] {
  // Regex Explanation:
  // 1. (?=^#{1,3}\s)  -> Positive lookahead for H1-H3 headers
  // 2. (?=^---)       -> Positive lookahead for horizontal rules (Perplexity turn separators)
  // The '|' means split on EITHER of these.
  const splitRegex = /(?=^#{1,3}\s)|(?=^---)/gm

  const sections = markdown.split(splitRegex)

  const chunks: string[] = []
  let currentChunk = ''

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    // Check if adding this section exceeds maxChars
    if (currentChunk.length + trimmed.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      // Start new chunk with overlap
      // We strip the "---" from the start if it exists to clean up the overlap
      const overlapText = currentChunk.slice(-overlap).replace(/^---\s*/, '')
      currentChunk = overlapText + '\n\n' + trimmed
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim())
  }

  // Fallback: If a single section is STILL huge (larger than maxChars + buffer), force split it
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars + 500) return [chunk]

    // Hard split for massive blocks
    const subChunks: string[] = []
    for (let i = 0; i < chunk.length; i += maxChars) {
      subChunks.push(chunk.slice(i, i + maxChars))
    }
    return subChunks
  })
}
