export function chunkMarkdown(markdown: string, maxChars = 1500, overlap = 150): string[] {
  const splitByHeaderOrRule = /(?=^#{1,3}\s)|(?=^---)/gm

  const sections = markdown.split(splitByHeaderOrRule)

  const chunks: string[] = []
  let currentChunk = ''

  for (const section of sections) {
    const trimmedSection = section.trim()
    if (!trimmedSection) continue

    if (currentChunk.length + trimmedSection.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())

      const overlapText = currentChunk.slice(-overlap).replace(/^---\s*/, '')
      currentChunk = overlapText + '\n\n' + trimmedSection
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedSection
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim())
  }

  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars + 500) return [chunk]

    const subChunks: string[] = []
    for (let i = 0; i < chunk.length; i += maxChars) {
      subChunks.push(chunk.slice(i, i + maxChars))
    }
    return subChunks
  })
}
