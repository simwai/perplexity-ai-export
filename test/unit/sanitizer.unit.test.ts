import { describe, it, expect } from 'vitest'
import {
  sanitizeFilename,
  sanitizeMarkdownContent,
  sanitizeSpaceName,
} from '../../src/export/sanitizer.js'

describe('sanitizeFilename', () => {
  it('should replace illegal filesystem characters', () => {
    const dangerousName = 'file<>:"/\\|?*test'
    const sanitizedName = sanitizeFilename(dangerousName)

    expect(sanitizedName).not.toMatch(/[<>:"/\\|?*]/)
  })

  it('should replace spaces with underscores', () => {
    expect(sanitizeFilename('my file name')).toBe('my_file_name')
  })

  it('should truncate to 100 chars to prevent path length issues', () => {
    const excessivelyLongName = 'a'.repeat(200)
    const truncatedName = sanitizeFilename(excessivelyLongName)

    expect(truncatedName.length).toBeLessThanOrEqual(100)
  })

  it('should handle problematic filenames gracefully', () => {
    expect(sanitizeFilename('..')).toBeTruthy()
    expect(sanitizeFilename('CON')).not.toBe('CON')
    expect(sanitizeFilename('')).toBe('')
  })
})

describe('sanitizeSpaceName', () => {
  it('should behave identically to sanitizeFilename', () => {
    const rawSpaceName = 'My Space: 2024'
    expect(sanitizeSpaceName(rawSpaceName)).toBe(sanitizeFilename(rawSpaceName))
  })
})

describe('sanitizeMarkdownContent', () => {
  it('should return content unchanged for normal markdown', () => {
    const rawMarkdownContent = '## My Header\n\nContent with `code` and **bold**'
    const processedContent = sanitizeMarkdownContent(rawMarkdownContent)

    expect(processedContent).toContain('## My Header')
  })

  it('should handle empty input gracefully', () => {
    expect(sanitizeMarkdownContent('')).toBe('')
  })

  it('should handle null or undefined input by returning empty string', () => {
    expect(sanitizeMarkdownContent(null as any)).toBe('')
    expect(sanitizeMarkdownContent(undefined as any)).toBe('')
  })
})
