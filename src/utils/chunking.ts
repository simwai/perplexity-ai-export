export function chunkMarkdown(sourceMarkdownText: string, maximumCharactersPerChunk = 1500, overlapCharactersBetweenChunks = 150): string[] {
  const MARKDOWN_SECTION_MARKER_REGEX = /(?=^#{1,3}\s)|(?=^---)/gm
  const markdownSections = sourceMarkdownText.split(MARKDOWN_SECTION_MARKER_REGEX)
  const resultChunks: string[] = []
  let currentChunkTextBuffer = ''

  for (const markdownSection of markdownSections) {
    const trimmedSectionText = markdownSection.trim()
    if (!trimmedSectionText) continue

    const isChunkFull = currentChunkTextBuffer.length + trimmedSectionText.length > maximumCharactersPerChunk
    const hasExistingContentInChunk = currentChunkTextBuffer.length > 0

    if (isChunkFull && hasExistingContentInChunk) {
      resultChunks.push(currentChunkTextBuffer.trim())
      const overlapText = currentChunkTextBuffer.slice(-overlapCharactersBetweenChunks).replace(/^---\s*/, '')
      currentChunkTextBuffer = overlapText + '\n\n' + trimmedSectionText
    } else {
      const sectionSeparator = currentChunkTextBuffer ? '\n\n' : ''
      currentChunkTextBuffer += sectionSeparator + trimmedSectionText
    }
  }

  if (currentChunkTextBuffer.trim()) {
    resultChunks.push(currentChunkTextBuffer.trim())
  }

  return resultChunks.flatMap(accumulatedChunk => {
    const MAXIMUM_ALLOWED_CHUNK_SIZE_BEFORE_SPLITTING = maximumCharactersPerChunk + 500
    if (accumulatedChunk.length <= MAXIMUM_ALLOWED_CHUNK_SIZE_BEFORE_SPLITTING) {
      return [accumulatedChunk]
    }

    const subChunksAfterSplittingLargeBlock: string[] = []
    for (let currentOffset = 0; currentOffset < accumulatedChunk.length; currentOffset += maximumCharactersPerChunk) {
      subChunksAfterSplittingLargeBlock.push(accumulatedChunk.slice(currentOffset, currentOffset + maximumCharactersPerChunk))
    }
    return subChunksAfterSplittingLargeBlock
  })
}
