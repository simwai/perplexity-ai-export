import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../')

function loadEscapeHtml(): (value: unknown) => string {
  const source = readFileSync(resolve(PROJECT_ROOT, 'public/app.js'), 'utf-8')
  const match = source.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/)
  if (!match) throw new Error('escapeHtml not found in public/app.js')
  const factory = new Function(`${match[0]}; return escapeHtml;`)
  return factory() as (value: unknown) => string
}

const escapeHtml = loadEscapeHtml()

describe('escapeHtml', () => {
  it('should escape angle brackets in tag-breakout payloads', () => {
    expect(escapeHtml('"><img src=x onerror=1>')).toBe('&quot;&gt;&lt;img src=x onerror=1&gt;')
  })

  it('should escape double quotes as &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it('should escape single quotes and ampersands', () => {
    expect(escapeHtml("it's & <them>")).toBe('it&#039;s &amp; &lt;them&gt;')
  })

  it('should leave plain labels untouched', () => {
    expect(escapeHtml('All Conversations')).toBe('All Conversations')
  })
})
