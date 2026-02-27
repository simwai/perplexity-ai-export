import { describe, it, expect } from 'vitest'
import { chunkMarkdown } from '../../src/utils/chunking.js'

describe('chunkMarkdown - Business Logic', () => {
  it('should split content exceeding maxChars into multiple chunks', () => {
    const largeText = 'a'.repeat(3000)
    const markdown = `# Title\n\n${largeText}`

    const result = chunkMarkdown(markdown, 1500)

    expect(result.length).toBeGreaterThan(1)
  })

  it('should split by horizontal rules for conversation turns', () => {
    const conversation = ['## Question 1', 'Answer 1', '---', '## Question 2', 'Answer 2'].join(
      '\n\n'
    )

    const result = chunkMarkdown(conversation, 50)

    expect(result.length).toBeGreaterThan(1)
    expect(result[0]).toContain('Question 1')
  })

  it('should respect overlap to preserve context across boundaries', () => {
    const markdown = 'Section A content here\n\n---\n\nSection B content'

    const result = chunkMarkdown(markdown, 30, 10)

    expect(result.length).toBeGreaterThan(1)
    const lastCharsOfFirst = result[0]!.slice(-10)
    expect(result[1]).toContain(lastCharsOfFirst.trim().slice(0, 5))
  })

  it('should handle empty input without errors', () => {
    expect(chunkMarkdown('')).toEqual([])
  })

  it('should handle edge case of single tiny chunk', () => {
    const tiny = '# Short'
    const result = chunkMarkdown(tiny, 5000)

    expect(result).toEqual(['# Short'])
  })
})
