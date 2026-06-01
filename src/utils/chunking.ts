export function chunkMarkdown(text: string, max = 1500, overlap = 150): string[] {
  const MARKER = /(?=^#{1,3}\s)|(?=^---)/gm
  const sections = text.split(MARKER)
  const chunks: string[] = []
  let current = ''

  for (const s of sections) {
    const trimmed = s.trim()
    if (!trimmed) continue
    if (current.length + trimmed.length > max && current.length > 0) {
      chunks.push(current.trim())
      current = current.slice(-overlap).replace(/^---\s*/, '') + '\n\n' + trimmed
    } else {
      current += (current ? '\n\n' : '') + trimmed
    }
  }
  if (current.trim()) chunks.push(current.trim())

  return chunks.flatMap(c => {
    if (c.length <= max + 500) return [c]
    const sub: string[] = []
    for (let i = 0; i < c.length; i += max) sub.push(c.slice(i, i + max))
    return sub
  })
}
