import sanitize from 'sanitize-filename'

export function sanitizeFilename(rawFilename: string): string {
  const ILLEGAL_CHARACTER_REPLACEMENT = '_'
  const MAXIMUM_FILENAME_LENGTH = 100

  const safeFilename = sanitize(rawFilename, {
    replacement: ILLEGAL_CHARACTER_REPLACEMENT,
  })

  return safeFilename
    .replace(/\s+/g, ILLEGAL_CHARACTER_REPLACEMENT)
    .substring(0, MAXIMUM_FILENAME_LENGTH)
}

export function sanitizeSpaceName(rawSpaceName: string): string {
  return sanitizeFilename(rawSpaceName)
}

export function sanitizeMarkdownContent(rawMarkdownText: string): string {
  return rawMarkdownText || ''
}
