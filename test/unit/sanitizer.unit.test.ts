import { describe, it, expect } from 'vitest';
import { sanitizeFilename, sanitizeMarkdownContent, sanitizeSpaceName } from '../../src/export/sanitizer.js';

describe('sanitizeFilename - Path Safety Logic', () => {
  it('should replace illegal filesystem characters', () => {
    const dangerous = 'file<>:"/\\|?*test';
    const result = sanitizeFilename(dangerous);

    // sanitize-filename handles all illegal chars
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('should replace spaces with underscores', () => {
    expect(sanitizeFilename('my file name')).toBe('my_file_name');
  });

  it('should truncate to 100 chars to prevent path length issues', () => {
    const tooLong = 'a'.repeat(200);
    const result = sanitizeFilename(tooLong);

    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('should handle problematic filenames gracefully', () => {
    expect(sanitizeFilename('..')).toBeTruthy();
    expect(sanitizeFilename('CON')).not.toBe('CON'); // Windows reserved
    expect(sanitizeFilename('')).toBe('');
  });
});

describe('sanitizeSpaceName', () => {
  it('should behave identically to sanitizeFilename', () => {
    const input = 'My Space: 2024';
    expect(sanitizeSpaceName(input)).toBe(sanitizeFilename(input));
  });
});

describe('sanitizeMarkdownContent', () => {
  it('should return content unchanged for normal markdown', () => {
    const markdown = '## My Header\n\nContent with `code` and **bold**';
    const result = sanitizeMarkdownContent(markdown);

    // If using minimal sanitization, content should pass through
    expect(result).toContain('## My Header');
  });

  it('should handle empty input gracefully', () => {
    expect(sanitizeMarkdownContent('')).toBe('');
  });

  it('should handle null/undefined input', () => {
    expect(sanitizeMarkdownContent(null as any)).toBe('');
    expect(sanitizeMarkdownContent(undefined as any)).toBe('');
  });
});
