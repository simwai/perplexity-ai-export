import sanitize from 'sanitize-filename'

export function sanitizeFilename(filename: string): string {
  const illegalCharacterReplacement = '_'
  const maximumFilenameLength = 100

  return sanitize(filename, {
    replacement: illegalCharacterReplacement,
  })
    .replace(/\s+/g, '_')
    .substring(0, maximumFilenameLength)
}

export function sanitizeSpaceName(spaceName: string): string {
  return sanitizeFilename(spaceName)
}

export function sanitizeMarkdownContent(raw: string): string {
  return raw || ''
}
