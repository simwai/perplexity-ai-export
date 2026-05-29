import sanitize from 'sanitize-filename'

export function sanitizeFilename(filename: string): string {
  const ILLEGAL_CHARACTER_REPLACEMENT = '_'
  const MAXIMUM_FILENAME_LENGTH = 100

  const safeFilename = sanitize(filename, {
    replacement: ILLEGAL_CHARACTER_REPLACEMENT,
  })

  return safeFilename
    .replace(/\s+/g, ILLEGAL_CHARACTER_REPLACEMENT)
    .substring(0, MAXIMUM_FILENAME_LENGTH)
}

export function sanitizeSpaceName(spaceName: string): string {
  return sanitizeFilename(spaceName)
}

export function sanitizeMarkdownContent(rawMarkdown: string): string {
  return rawMarkdown || ''
}
