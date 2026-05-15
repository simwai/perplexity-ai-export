import sanitize from 'sanitize-filename'

export function sanitizeFilename(filename: string): string {
  const illegalCharacterReplacement = '_'
  const maximumFilenameByteLength = 80

  const sanitizedFilename = sanitize(filename, {
    replacement: illegalCharacterReplacement,
  }).replace(/\s+/g, '_')

  return truncateUtf8(sanitizedFilename, maximumFilenameByteLength)
}

export function sanitizeSpaceName(spaceName: string): string {
  return sanitizeFilename(spaceName)
}

export function sanitizeMarkdownContent(raw: string): string {
  return raw || ''
}

function truncateUtf8(value: string, maximumByteLength: number): string {
  let output = ''
  for (const character of value) {
    const next = output + character
    if (Buffer.byteLength(next, 'utf-8') > maximumByteLength) {
      break
    }
    output = next
  }
  return output
}
