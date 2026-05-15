import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export interface BundleOptions {
  inputs: string[]
  titlePrefix: string
  outPath: string
  threadId?: string
  title?: string
}

interface SourceDocument {
  path: string
  kind: 'markdown'
  ordinal: number
  text: string
}

interface ParsedTurn {
  question: string
  answer: string
  sourcePath: string
  sourceOrdinal: number
  segmentIndex: number
}

export interface BundleSummary {
  outPath: string
  sourceFiles: number
  parsedTurns: number
  uniqueTurns: number
  messages: number
}

const DEFAULT_THREAD_ID = 'perplexity-download-bundle'

export function bundlePerplexityDownloads(options: BundleOptions): BundleSummary {
  const sourceDocuments = discoverMarkdownSources(options.inputs, options.titlePrefix)
  if (sourceDocuments.length === 0) {
    throw new Error(`No Markdown downloads matched title prefix: ${options.titlePrefix}`)
  }

  const parsedTurns = sourceDocuments.flatMap((source) => parseMarkdownTurns(source))
  const uniqueTurns = dedupeTurns(parsedTurns)
  const threadId = options.threadId ?? DEFAULT_THREAD_ID
  const title =
    options.title ?? sourceDocuments[0]?.text.match(/^#\s+(.+)$/m)?.[1] ?? options.titlePrefix
  const exportedAt = new Date().toISOString()

  const messages = uniqueTurns.flatMap((turn, turnIndex) => [
    {
      role: 'user',
      content: turn.question,
      source_message_id: `${threadId}:download:${turnIndex + 1}:user`,
      created_at: exportedAt,
      turn_index: turnIndex,
      provenance: {
        source: 'perplexity_download_markdown',
        source_path: turn.sourcePath,
        source_ordinal: turn.sourceOrdinal,
        segment_index: turn.segmentIndex,
      },
    },
    {
      role: 'assistant',
      content: turn.answer,
      source_message_id: `${threadId}:download:${turnIndex + 1}:assistant`,
      created_at: exportedAt,
      turn_index: turnIndex,
      provenance: {
        source: 'perplexity_download_markdown',
        source_path: turn.sourcePath,
        source_ordinal: turn.sourceOrdinal,
        segment_index: turn.segmentIndex,
      },
    },
  ])

  const bundle = {
    schema: 'itir.perplexity.thread.v1',
    source: 'perplexity_download_bundle',
    source_thread_id: threadId,
    url: '',
    title,
    space: 'Downloaded Perplexity',
    updated_at: exportedAt,
    exported_at: exportedAt,
    messages,
    raw: {
      source_files: sourceDocuments.map((source) => ({
        path: source.path,
        kind: source.kind,
        ordinal: source.ordinal,
        bytes: Buffer.byteLength(source.text, 'utf8'),
      })),
      parsed_turns: parsedTurns.length,
      unique_turns: uniqueTurns.length,
    },
  }

  const absoluteOutPath = resolve(options.outPath)
  const outDir = dirname(absoluteOutPath)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }
  writeFileSync(absoluteOutPath, JSON.stringify(bundle, null, 2), 'utf8')

  return {
    outPath: absoluteOutPath,
    sourceFiles: sourceDocuments.length,
    parsedTurns: parsedTurns.length,
    uniqueTurns: uniqueTurns.length,
    messages: messages.length,
  }
}

export function discoverMarkdownSources(inputs: string[], titlePrefix: string): SourceDocument[] {
  const normalizedPrefix = normalizeTitlePrefix(titlePrefix)
  const candidates = inputs.flatMap((input) => collectMarkdownFiles(resolve(input)))

  return candidates
    .filter((path) =>
      normalizeTitlePrefix(basename(path, extname(path))).startsWith(normalizedPrefix)
    )
    .map((path) => ({
      path,
      kind: 'markdown' as const,
      ordinal: extractOrdinal(path),
      text: readFileSync(path, 'utf8'),
    }))
    .sort((a, b) => a.ordinal - b.ordinal || a.path.localeCompare(b.path))
}

export function parseMarkdownTurns(source: SourceDocument): ParsedTurn[] {
  const body = stripPerplexityChrome(source.text)
  const chunks = body
    .split(/\n-{3,}\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const turns: ParsedTurn[] = []
  for (let segmentIndex = 0; segmentIndex < chunks.length; segmentIndex++) {
    const parsed = parseMarkdownChunk(chunks[segmentIndex] ?? '')
    if (!parsed) continue
    turns.push({
      ...parsed,
      sourcePath: source.path,
      sourceOrdinal: source.ordinal,
      segmentIndex,
    })
  }
  return turns
}

function parseMarkdownChunk(chunk: string): Pick<ParsedTurn, 'question' | 'answer'> | null {
  const heading = chunk.match(/^#\s+(.+?)(?:\n|$)/s)
  if (!heading) return null

  const question = cleanText(heading[1] ?? '')
  const answer = cleanText(chunk.slice(heading[0].length))
  if (!question || !answer) return null
  return { question, answer }
}

function dedupeTurns(turns: ParsedTurn[]): ParsedTurn[] {
  const seen = new Set<string>()
  const unique: ParsedTurn[] = []

  for (const turn of turns) {
    const key = hashTurn(turn)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(turn)
  }
  return unique
}

function hashTurn(turn: Pick<ParsedTurn, 'question' | 'answer'>): string {
  return createHash('sha1')
    .update(normalizeForDedupe(turn.question))
    .update('\0')
    .update(normalizeForDedupe(turn.answer))
    .digest('hex')
}

function stripPerplexityChrome(text: string): string {
  return text
    .replace(/<img\b[^>]*pplx-full-logo[^>]*>\s*/gi, '')
    .replace(/<span style="display:none">[\s\S]*?<\/span>/gi, '')
    .replace(/<div align="center">[\s\S]*?<\/div>/gi, '')
    .trim()
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function normalizeForDedupe(text: string): string {
  return cleanText(text).replace(/\s+/g, ' ').toLowerCase()
}

function normalizeTitlePrefix(text: string): string {
  return text
    .replace(/\(\d+\)$/g, '')
    .replace(/-\d+$/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function collectMarkdownFiles(path: string): string[] {
  if (!existsSync(path)) return []
  const stats = statSync(path)
  if (stats.isFile()) {
    return extname(path).toLowerCase() === '.md' ? [path] : []
  }
  if (!stats.isDirectory()) return []

  return readdirSync(path)
    .map((entry) => join(path, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isFile() && extname(entryPath).toLowerCase() === '.md'
      } catch (_error) {
        return false
      }
    })
}

function extractOrdinal(path: string): number {
  const name = basename(path, extname(path))
  const parenMatch = name.match(/\((\d+)\)$/)
  if (parenMatch?.[1]) return Number(parenMatch[1])
  const dashMatch = name.match(/-(\d+)$/)
  if (dashMatch?.[1]) return Number(dashMatch[1])
  return 0
}
