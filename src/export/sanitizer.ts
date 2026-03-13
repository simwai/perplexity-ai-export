import sanitize from 'sanitize-filename'

export function sanitizeFilename(filename: string): string {
  return sanitize(filename, {
    replacement: '_', // Replace illegal chars with underscore
  })
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 100) // Keep max length limit
}

export function sanitizeSpaceName(spaceName: string): string {
  return sanitizeFilename(spaceName)
}

export function sanitizeMarkdownContent(raw: string): string {
  return raw || ''
}
