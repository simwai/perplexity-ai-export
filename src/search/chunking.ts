// why: 1500 chars ≈ ~375 tokens (4 chars/token), fits common embedding model windows
// why: 150 chars overlap preserves context between chunks without excessive duplication
// why: 500 char slack allows sections slightly over maxChars to not trigger hard-slice on every boundary
const DEFAULT_MAX_CHARS = 1500
const DEFAULT_OVERLAP_CHARS = 150
const OVERSIZED_CHUNK_SLACK = 500

export function chunkMarkdown(
  markdown: string,
  maxChars = DEFAULT_MAX_CHARS,
  overlapChars = DEFAULT_OVERLAP_CHARS
): string[] {
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

  const MAX_CHUNK_THRESHOLD = maxChars + OVERSIZED_CHUNK_SLACK
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
