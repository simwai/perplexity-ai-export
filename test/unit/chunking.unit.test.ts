import { describe, it, expect } from 'vitest'
import { chunkMarkdown } from '../../src/utils/chunking.js'

describe('chunkMarkdown', () => {
  it('should split content exceeding maxChars into multiple chunks', () => {
    const largeContent = 'a'.repeat(3000)
    const rawMarkdown = `# Title\n\n${largeContent}`

    const contentChunks = chunkMarkdown(rawMarkdown, 1500)

    expect(contentChunks.length).toBeGreaterThan(1)
  })

  it('should split by horizontal rules for conversation turns', () => {
    const multiTurnConversation = [
      '## Question 1',
      'Answer 1',
      '---',
      '## Question 2',
      'Answer 2',
    ].join('\n\n')

    const contentChunks = chunkMarkdown(multiTurnConversation, 50)

    expect(contentChunks.length).toBeGreaterThan(1)
    expect(contentChunks[0]).toContain('Question 1')
  })

  it('should respect overlap to preserve context across boundaries', () => {
    const multiSectionMarkdown = 'Section A content here\n\n---\n\nSection B content'

    const contentChunks = chunkMarkdown(multiSectionMarkdown, 30, 10)

    expect(contentChunks.length).toBeGreaterThan(1)
    const overlapCharactersFromFirstChunk = contentChunks[0]!.slice(-10)
    expect(contentChunks[1]).toContain(overlapCharactersFromFirstChunk.trim().slice(0, 5))
  })

  it('should handle empty input without errors', () => {
    expect(chunkMarkdown('')).toEqual([])
  })

  it('should handle edge case of single tiny chunk', () => {
    const shortMarkdown = '# Short'
    const contentChunks = chunkMarkdown(shortMarkdown, 5000)

    expect(contentChunks).toEqual(['# Short'])
  })
})
