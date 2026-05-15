import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundlePerplexityDownloads,
  discoverMarkdownSources,
  parseMarkdownTurns,
} from '../../src/download-import/perplexity-download-bundler.js'

describe('Perplexity download bundler', () => {
  it('discovers numbered Markdown exports in ordinal order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pplx-downloads-'))
    writeFileSync(join(dir, 'Example Perplexity Thread(2).md'), '# two\n\nb')
    writeFileSync(join(dir, 'Example Perplexity Thread.md'), '# zero\n\nb')
    writeFileSync(join(dir, 'Other.md'), '# other\n\nb')

    const sources = discoverMarkdownSources([dir], 'Example Perplexity Thread')

    expect(sources.map((source) => source.ordinal)).toEqual([0, 2])
  })

  it('parses Perplexity Markdown sections as user and assistant turns', () => {
    const turns = parseMarkdownTurns({
      path: '/tmp/source.md',
      kind: 'markdown',
      ordinal: 0,
      text: '<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png"/>\n\n# first question\n\nfirst answer\n\n---\n\n# second question\n\nsecond answer\n',
    })

    expect(turns).toMatchObject([
      { question: 'first question', answer: 'first answer' },
      { question: 'second question', answer: 'second answer' },
    ])
  })

  it('writes a deduped ITIR Perplexity JSON bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pplx-downloads-'))
    const outPath = join(dir, 'bundle.itir.perplexity.json')
    const content = '# q\n\na\n\n---\n\n# q\n\na\n'
    writeFileSync(join(dir, 'Example Perplexity Thread.md'), content)

    const summary = bundlePerplexityDownloads({
      inputs: [dir],
      titlePrefix: 'Example Perplexity Thread',
      outPath,
      threadId: 'test-thread',
    })
    const bundle = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(summary.parsedTurns).toBe(2)
    expect(summary.uniqueTurns).toBe(1)
    expect(bundle.schema).toBe('itir.perplexity.thread.v1')
    expect(bundle.messages).toHaveLength(2)
    expect(bundle.messages[0].source_message_id).toBe('test-thread:download:1:user')
  })
})
