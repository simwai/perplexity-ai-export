export function chunkMarkdown(markdown: string, maxChars = 1500, overlapChars = 150): string[] {
  const HEADER_OR_RULE_REGEX = /(?=^#{1,3}\s)|(?=^---)/gm

  const sections = markdown.split(HEADER_OR_RULE_REGEX)

  const chunks: string[] = []
  let currentChunk = ''

  for (const section of sections) {
    const trimmedSection = section.trim()
    if (!trimmedSection) continue

    const wouldExceedMaxSize = currentChunk.length + trimmedSection.length > maxChars
    const isCurrentChunkPopulated = currentChunk.length > 0

    if (wouldExceedMaxSize && isCurrentChunkPopulated) {
      chunks.push(currentChunk.trim())

      const overlapText = currentChunk.slice(-overlapChars).replace(/^---\s*/, '')
      currentChunk = overlapText + '\n\n' + trimmedSection
    } else {
      const separator = currentChunk ? '\n\n' : ''
      currentChunk += separator + trimmedSection
    }
  }

  const trimmedRemainingChunk = currentChunk.trim()
  if (trimmedRemainingChunk.length > 0) {
    chunks.push(trimmedRemainingChunk)
  }

  const MAX_CHUNK_THRESHOLD = maxChars + 500
  return chunks.flatMap((chunk) => {
    if (chunk.length <= MAX_CHUNK_THRESHOLD) {
      return [chunk]
    }

    const oversizedSubChunks: string[] = []
    for (let offset = 0; offset < chunk.length; offset += maxChars) {
      oversizedSubChunks.push(chunk.slice(offset, offset + maxChars))
    }
    return oversizedSubChunks
  })
}
