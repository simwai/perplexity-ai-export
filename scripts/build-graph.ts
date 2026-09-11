import { writeFile, readdir, readFile } from 'node:fs/promises'
import { dirname, resolve, join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Result, from } from 'super-result'
import cytoscape from 'cytoscape'
import { logger } from '../src/utils/logger.js'
import type {
  CytoscapeEdge,
  CytoscapeElements,
  CytoscapeNode,
  FileMeta,
  NodePosition,
} from './graph-types.js'
import { buildSemanticHierarchies, hierarchyToCytoscape } from './build-semantic-hierarchy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = resolve(__dirname, '../exports')
const OUTPUT_FILE = resolve(__dirname, '../public/graph.json')
const OVERRIDES_FILE = resolve(__dirname, '../taxonomy-overrides.yaml')

const MAX_LABEL_LENGTH = 60
const TOP_KEYWORDS_PER_FILE = 8
const MIN_KEYWORD_DF = 2 // document frequency threshold
const ROOT_FOLDER = '_root'

// Stop words to filter out
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  "it's",
  'you',
  'your',
  'yours',
  'i',
  'me',
  'my',
  'we',
  'our',
  'us',
  'they',
  'them',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'where',
  'when',
  'why',
  'how',
  'is',
  'are',
  'am',
  'been',
  'be',
  'was',
  'were',
  'has',
  'have',
  'had',
  'do',
  'did',
  'will',
  'would',
  'should',
  'could',
  'may',
  'might',
  'must',
  'can',
  'shall',
  'ought',
  'need',
  'dare',
  'used',
  'using',
  'use',
  'uses',
  'also',
  'such',
  'than',
  'then',
  'there',
  'here',
  'when',
  'where',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'too',
  'very',
  'just',
  'now',
  'out',
  'up',
  'down',
  'off',
  'over',
  'under',
  'again',
  'further',
  'once',
  'here',
  'there',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'about',
  'against',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'about',
  'against',
  'per',
  'via',
  'vs',
  'vs.',
  'etc',
  'e.g.',
  'i.e.',
  // Code-related stop words
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'class',
  'interface',
  'type',
  'import',
  'export',
  'from',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'this',
  'super',
  'extends',
  'implements',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'void',
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
  'undefined',
  'any',
  'never',
  'unknown',
  'file',
  'files',
  'context',
  'data',
  'config',
  'api',
  'http',
  'https',
  'url',
  'json',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'node',
  'npm',
  'yarn',
  'pnpm',
  'git',
  'github',
  'docker',
  'kubernetes',
  'test',
  'tests',
  'spec',
  'specs',
  'mock',
  'stub',
  'spy',
  'describe',
  'it',
  'expect',
  'before',
  'after',
  'each',
  'all',
  'beforeeach',
  'aftereach',
  'beforeall',
  'afterall',
  'setup',
  'teardown',
  'jest',
  'vitest',
  'mocha',
  'assert',
  'equal',
  'deep',
  'strict',
  'throw',
  'error',
  'catch',
  'finally',
  'promise',
  'then',
  'catch',
  'await',
  'resolve',
  'reject',
  'async',
  'sync',
  'callback',
  'thenable',
  'then',
  'catch',
  'finally',
  'timeout',
  'interval',
  'settimeout',
  'setinterval',
  'cleartimeout',
  'clearinterval',
  'map',
  'filter',
  'reduce',
  'foreach',
  'find',
  'some',
  'every',
  'includes',
  'indexof',
  'push',
  'pop',
  'shift',
  'unshift',
  'slice',
  'splice',
  'concat',
  'keys',
  'values',
  'entries',
  'length',
  'constructor',
  'prototype',
  'instanceof',
  'typeof',
  'delete',
  'in',
  'of',
  'new',
  'yield',
  'generator',
  'iterator',
  'symbol',
  'reflect',
  'proxy',
  'handler',
  'trap',
  'apply',
  'construct',
  'defineproperty',
  'getownpropertydescriptor',
  'getownpropertynames',
  'keys',
  'values',
  'entries',
  'assign',
  'freeze',
  'seal',
  'preventextensions',
  'isextensible',
  'isfrozen',
  'issealed',
  'getprototypeof',
  'setprototypeof',
  'create',
  'defineproperties',
  'getownpropertydescriptors',
  'ownkeys',
  'hasown',
  'is',
  'isnot',
  'equals',
  'notequals',
  'lessthan',
  'greaterthan',
  'lessorequal',
  'greaterorequal',
  'and',
  'or',
  'not',
  'xor',
  'nand',
  'nor',
  'true',
  'false',
  'null',
  'undefined',
  'nan',
  'infinity',
  'isnan',
  'isfinite',
  'parseint',
  'parsefloat',
  'number',
  'string',
  'boolean',
  'object',
  'array',
  'date',
  'regexp',
  'error',
  'typeerror',
  'referenceerror',
  'syntaxerror',
  'rangeerror',
  'evalerror',
  'urierror',
  'aggregateerror',
  'promise',
  'then',
  'catch',
  'finally',
  'all',
  'race',
  'allsettled',
  'any',
  'resolve',
  'reject',
  'finally',
  'catch',
  'then',
  'async',
  'await',
  'generator',
  'asynciterator',
  'asyncgenerator',
  'for',
  'of',
  'await',
  'yield',
  'return',
  'break',
  'continue',
  'switch',
  'case',
  'default',
  'throw',
  'try',
  'catch',
  'finally',
  'debugger',
  'with',
  'eval',
  'arguments',
  'callee',
  'caller',
  'length',
  'name',
  'displayname',
  'prototype',
  '__proto__',
  '__definegetter__',
  '__definesetter__',
  '__lookupgetter__',
  '__lookupsetter__',
  'hasownproperty',
  'propertyisenumerable',
  'isprototypeof',
  'valueof',
  'tostring',
  'tolocalestring',
  'toisostring',
  'tojson',
  'valueof',
  'constructor',
  'tofixed',
  'toexponential',
  'toprecision',
  'tostring',
  'valueof',
  'charat',
  'charcodeat',
  'concat',
  'indexof',
  'lastindexof',
  'localecompare',
  'match',
  'replace',
  'search',
  'slice',
  'split',
  'substring',
  'tolowercase',
  'touppercase',
  'trim',
  'trimstart',
  'trimend',
  'padstart',
  'padend',
  'repeat',
  'codepointat',
  'fromcodepoint',
  'normalize',
  'includes',
  'startswith',
  'endswith',
  'localecompare',
  'matchall',
  'replaceall',
  'at',
  'replaceall',
  'substring',
  'substr',
  'bold',
  'italics',
  'fixed',
  'strike',
  'sub',
  'sup',
  'blink',
  'link',
  'anchor',
  'big',
  'small',
  'fontcolor',
  'fontsize',
  'italics',
  'bold',
  'fixed',
  'strike',
  'sub',
  'sup',
  'link',
  'anchor',
  'big',
  'small',
  'fontcolor',
  'fontsize',
])

// German stop words too (since some exports are in German)
const DE_STOP_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'eines',
  'und',
  'oder',
  'aber',
  'in',
  'auf',
  'an',
  'zu',
  'f\u00fcr',
  'von',
  'mit',
  'durch',
  '\u00fcber',
  'unter',
  'zwischen',
  'bei',
  'nach',
  'vor',
  'seit',
  'bis',
  'aus',
  'bei',
  'gegen',
  'ohne',
  'um',
  'wie',
  'was',
  'wer',
  'wo',
  'wann',
  'warum',
  'wie',
  'ich',
  'du',
  'er',
  'sie',
  'es',
  'wir',
  'ihr',
  'sie',
  'mein',
  'dein',
  'sein',
  'ihr',
  'unser',
  'euer',
  'ihr',
  'dies',
  'das',
  'das',
  'da',
  'hier',
  'dort',
  'jetzt',
  'dann',
  'wenn',
  'als',
  'wie',
  'so',
  'auch',
  'nur',
  'noch',
  'schon',
  'immer',
  'nie',
  'oft',
  'man',
  'einer',
  'eines',
  'einem',
  'einen',
  'deren',
  'deren',
  'welcher',
  'welche',
  'welches',
  'ist',
  'nicht',
  'dass',
  'f\u00fcr',
  'ein',
  'eine',
  'einen',
  'einem',
  'eines',
  'mit',
  'auf',
  'von',
  'zu',
  'im',
  'am',
  'zum',
  'zur',
  '\u00fcber',
  'unter',
  'wir',
  'sie',
  'ihr',
  'uns',
  'euch',
  'ihnen',
  'mir',
  'dir',
  'sich',
  'kann',
  'k\u00f6nnen',
  'muss',
  'm\u00fcssen',
  'soll',
  'sollen',
  'will',
  'wollen',
  'hat',
  'haben',
  'hatte',
  'hatten',
  'war',
  'waren',
  'bin',
  'bist',
  'ist',
  'sind',
  'werde',
  'wirst',
  'wird',
  'werden',
  'w\u00fcrde',
  'w\u00fcrdest',
  'w\u00fcrde',
  'w\u00fcrden',
  'habe',
  'hast',
  'haben',
  'hat',
  'hatten',
  'sein',
  'seien',
  'war',
  'waren',
  'w\u00e4re',
  'w\u00e4ren',
  'w\u00fcrde',
  'w\u00fcrden',
  'k\u00f6nnte',
  'k\u00f6nnten',
  'm\u00f6chte',
  'm\u00f6chten',
  'sollte',
  'sollten',
  'd\u00fcrfte',
  'd\u00fcrften',
  'm\u00fcssste',
  'm\u00fcsssten',
  'kunden',
  'kunde',
  'kunden',
  'projekt',
  'projekte',
  'team',
  'teams',
  'meeting',
  'meetings',
  'termin',
  'termine',
  'zeit',
  'zeiten',
  'tag',
  'tage',
  'woche',
  'wochen',
  'monat',
  'monate',
  'jahr',
  'jahre',
  'stunde',
  'stunden',
  'minute',
  'minuten',
  'sekunde',
  'sekunden',
  'morgen',
  'heute',
  'gestern',
  'jetzt',
  'sp\u00e4ter',
  'fr\u00fcher',
  'damals',
  'einmal',
  'mal',
  'mal',
  'mal',
  'immer',
  'oft',
  'selten',
  'manchmal',
  'manchmal',
  'manchmal',
  'oft',
  'manchmal',
  'immer',
  'selten',
  'nie',
  'nie',
  'nie',
  'niemals',
  'niemals',
  'niemand',
  'niemand',
  'niemand',
  'jemand',
  'jemand',
  'jemand',
  'alles',
  'alles',
  'alles',
  'nichts',
  'nichts',
  'nichts',
  'etwas',
  'etwas',
  'etwas',
  'manche',
  'manche',
  'manche',
  'viele',
  'viele',
  'viele',
  'wenige',
  'wenige',
  'wenige',
  'einige',
  'einige',
  'einige',
  'mehrere',
  'mehrere',
  'mehrere',
  'alle',
  'alle',
  'alle',
  'beide',
  'beide',
  'beide',
  'jeder',
  'jeder',
  'jeder',
  'keiner',
  'keiner',
  'keiner',
  'beide',
  'beide',
  'beide',
  'jeder',
  'jeder',
  'jeder',
  'keiner',
  'keiner',
  'keiner',
  'etwas',
  'etwas',
  'etwas',
  'nichts',
  'nichts',
  'nichts',
  'man',
  'man',
  'man',
  'frau',
  'frau',
  'frau',
  'kind',
  'kinder',
  'kinder',
  'eltern',
  'eltern',
  'eltern',
  'mutter',
  'vater',
  'schwester',
  'bruder',
  'onkel',
  'tante',
  'cousin',
  'cousine',
  'opa',
  'oma',
  'opa',
  'oma',
  'freund',
  'freunde',
  'freundin',
  'freundinnen',
  'kollege',
  'kollegen',
  'kollegin',
  'kolleginnen',
  'chef',
  'chefs',
  'chefin',
  'chefinnen',
  'mitarbeiter',
  'mitarbeiter',
  'mitarbeiterin',
  'mitarbeiterinnen',
  'kunde',
  'kunden',
  'kunden',
  'kunde',
  'kunden',
  'projekt',
  'projekte',
  'projekt',
  'projekte',
  'aufgabe',
  'aufgaben',
  'aufgabe',
  'aufgaben',
  'problem',
  'probleme',
  'l\u00f6sung',
  'l\u00f6sungen',
  'idee',
  'ideen',
  'plan',
  'pl\u00e4ne',
  'ziel',
  'ziele',
  'ergebnis',
  'ergebnisse',
  'erfolg',
  'erfolge',
  'fehler',
  'fehler',
  'risiko',
  'risiken',
  'chance',
  'chancen',
  'm\u00f6glichkeit',
  'm\u00f6glichkeiten',
  'alternative',
  'alternativen',
  'entscheidung',
  'entscheidungen',
  'meeting',
  'meetings',
  'besprechung',
  'besprechungen',
  'termin',
  'termine',
  'kalender',
  'kalender',
  'einladung',
  'einladungen',
  'teilnehmer',
  'teilnehmer',
  'agenda',
  'agenda',
  'protokoll',
  'protokolle',
  'notizen',
  'notizen',
  'memo',
  'memos',
  'dokument',
  'dokumente',
  'datei',
  'dateien',
  'ordner',
  'ordner',
  'verzeichnis',
  'verzeichnisse',
  'pfad',
  'pfade',
  'link',
  'links',
  'url',
  'urls',
  'website',
  'webseite',
  'seite',
  'seiten',
  'link',
  'links',
])

const ALL_STOP_WORDS = new Set([...STOP_WORDS, ...DE_STOP_WORDS])

// Code/tech patterns to filter out
const CODE_PATTERNS = [
  /^[a-z]+[A-Z]/, // camelCase
  /^[A-Z]{2,}$/, // ALL_CAPS acronyms
  /^\d+$/, // pure numbers
  /^[_-]+$/, // only underscores/dashes
  /^[^\w\s]+$/, // only punctuation
  /^\w{1,2}$/, // too short (1-2 chars)
  /^\d+\.\d+$/, // version numbers like 1.0
  /^v?\d+\.\d+\.\d+/, // semver
]

/**
 * Truncate a label to MAX_LABEL_LENGTH, breaking at a word boundary.
 */
function truncateLabel(text: string, maxLength: number = MAX_LABEL_LENGTH): string {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength - 1)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLength * 0.6) {
    return truncated.slice(0, lastSpace).trimEnd() + String.fromCharCode(0x2026)
  }
  return truncated.trimEnd() + String.fromCharCode(0x2026)
}

/**
 * Extract frontmatter tags from markdown content.
 */
function extractFrontmatterTags(content: string): string[] {
  const fmMatch = content.match(/^---([\s\S]*?)---/)
  if (!fmMatch) return []
  const fm = fmMatch[1] ?? ''
  const tagsMatch = fm.match(/tags:\s*\n((?:\s*-.*\n)*)/)
  if (!tagsMatch) {
    // Try inline tags: tags: [tag1, tag2] or tags: tag1, tag2
    const inlineMatch = fm.match(/tags:\s*(\[.*\]|.*)/)
    if (inlineMatch) {
      const tagsStr = (inlineMatch[1] ?? '').replace(/[[\]"']/g, '')
      return tagsStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
    return []
  }
  const tagsLines = (tagsMatch[1] ?? '').trim().split('\n')
  return tagsLines.map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean)
}

/**
 * Clean a Perplexity-exported filename into a human-readable label.
 */
function cleanFilename(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .replace(/\s*\([0-9a-f-]{36}\)\s*$/i, '')
    .replace(/^@[\w-]+_/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Simple tokenizer - splits on non-word characters, keeps alphanumeric + hyphen.
 * Filters out code-like tokens and fragments.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4) // minimum 4 chars
    .filter((token) => !ALL_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token)) // filter pure numbers
    .filter((token) => !CODE_PATTERNS.some((pattern) => pattern.test(token)))
    .filter((token) => !/^[_-]+$/.test(token)) // only underscores/dashes
    .filter((token) => !/^[.,;:()[\]{}]+$/.test(token)) // only punctuation
}

/**
 * Extract keywords from text using TF-IDF-like scoring.
 */
function extractKeywords(text: string, maxKeywords: number = TOP_KEYWORDS_PER_FILE): string[] {
  const tokens = tokenize(text)
  if (tokens.length === 0) return []

  // Count term frequencies
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1)
  }

  // Also extract bigrams (2-word phrases) - only from adjacent tokens in original text
  const bigrams = new Map<string, number>()
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + ' ' + tokens[i + 1]
    // Only keep bigrams where both words are meaningful (not stop words, already filtered)
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1)
  }

  // Score unigrams and bigrams
  const scored: Array<{ term: string; score: number }> = []

  for (const [term, freq] of tf.entries()) {
    if (freq >= 2) {
      // only unigrams appearing at least twice in the document
      scored.push({ term, score: freq })
    }
  }

  for (const [bigram, freq] of bigrams.entries()) {
    if (freq >= 2) {
      // only keep bigrams that appear at least twice
      // Only keep bigrams where both words are reasonably long
      const words = bigram.split(' ')
      const first = words[0]
      const second = words[1]
      if (first && second && first.length >= 4 && second.length >= 4) {
        scored.push({ term: bigram, score: freq * 1.5 })
      }
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Return top keywords
  return scored.slice(0, maxKeywords).map((s) => s.term)
}

/**
 * Extract frontmatter tags from markdown content.
 */

/**
 * Recursively walk a directory and collect all .md files with metadata.
 */
async function walkMarkdownFiles(rootDir: string): Promise<Result<Array<FileMeta>, Error>> {
  return from(
    (async () => {
      const results: FileMeta[] = []

      async function walk(currentDir: string, relativeDir: string): Promise<void> {
        const entries = await readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name)
          if (entry.isDirectory()) {
            const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
            await walk(fullPath, nextRelative)
          } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
            const relativePath = fullPath.slice(rootDir.length + 1).replace(/\\/g, '/')
            const cleanName = cleanFilename(entry.name)
            const content = await readFile(fullPath, 'utf-8')
            const frontmatterTags = extractFrontmatterTags(content)
            const contentKeywords = extractKeywords(content)

            results.push({
              relativePath,
              folder: relativeDir || ROOT_FOLDER,
              filename: entry.name,
              cleanName,
              frontmatterTags,
              contentKeywords,
            })
          }
        }
      }

      await walk(rootDir, '')
      return results
    })()
  )
}

// #region Graph Builder
export function folderLabel(folder: string): string {
  if (folder === ROOT_FOLDER) return ROOT_FOLDER
  const parts = folder.split('/')
  return parts[parts.length - 1] ?? folder
}

export function ancestorFolders(folder: string): string[] {
  if (folder === ROOT_FOLDER) return []
  const parts = folder.split('/')
  const ancestors: string[] = []
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'))
  }
  return ancestors
}

export function folderNodeId(folder: string): string {
  return `folder:${folder}`
}

export interface ParentOverrides {
  parents: Record<string, string>
}

/**
 * Parse the parents-only override file. Minimal on purpose: comments and
 * blank lines are ignored, only `child: parent` entries under `parents:`
 * are read, so no YAML dependency is needed for a handful of remaps.
 */
export function parseParentOverrides(text: string): ParentOverrides {
  const parents: Record<string, string> = {}
  let inParents = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (/^parents\s*:\s*$/.test(line)) {
      inParents = true
      continue
    }
    if (/^[\w-]+\s*:\s*$/.test(line)) {
      inParents = false
      continue
    }
    if (inParents) {
      const match = line.match(/^['"]?([^'":]+)['"]?\s*:\s*['"]?([^'"]+)['"]?$/)
      const child = match?.[1]?.trim()
      const parent = match?.[2]?.trim()
      if (child && parent) parents[child] = parent
    }
  }
  return { parents }
}

async function loadParentOverrides(): Promise<ParentOverrides> {
  const result = await from((async () => readFile(OVERRIDES_FILE, 'utf-8'))())
  if (!result.ok) return { parents: {} }
  return parseParentOverrides(result.value)
}

/**
 * Build Cytoscape elements from the file inventory with extracted keywords.
 */
function buildElements(files: FileMeta[], overrides: ParentOverrides): CytoscapeElements {
  const fileNodes: CytoscapeNode[] = []
  const keywordToFiles = new Map<string, Set<string>>() // keyword -> file node ids
  const folderToFiles = new Map<string, string[]>() // folder -> file node ids

  // First pass: collect all keywords across files
  const keywordDocFreq = new Map<string, number>()

  for (const f of files) {
    const nodeId = `file:${f.relativePath}`
    const label = truncateLabel(f.cleanName || f.filename)
    const allTags = [...new Set([...f.frontmatterTags, ...f.contentKeywords])]

    fileNodes.push({
      data: {
        id: nodeId,
        kind: 'file',
        label,
        title: f.cleanName || f.filename,
        path: f.relativePath,
        folder: f.folder,
        tags: allTags,
      },
    })

    if (!folderToFiles.has(f.folder)) folderToFiles.set(f.folder, [])
    folderToFiles.get(f.folder)!.push(nodeId)

    // Track keyword document frequency
    for (const tag of allTags) {
      if (!tag) continue
      if (!keywordDocFreq.has(tag)) keywordDocFreq.set(tag, 0)
      keywordDocFreq.set(tag, keywordDocFreq.get(tag)! + 1)
      if (!keywordToFiles.has(tag)) keywordToFiles.set(tag, new Set())
      keywordToFiles.get(tag)!.add(nodeId)
    }
  }

  // Every folder on any file path plus every ancestor gets a node, so the
  // topic tree stays connected even when an intermediate directory holds
  // no files directly. Override parents are added too, so a remap target
  // never dangles.
  const allFolders = new Set<string>([ROOT_FOLDER])
  for (const folder of folderToFiles.keys()) {
    allFolders.add(folder)
    for (const ancestor of ancestorFolders(folder)) allFolders.add(ancestor)
  }
  for (const parent of Object.values(overrides.parents)) allFolders.add(parent)

  const folderNodes: CytoscapeNode[] = []
  for (const folder of allFolders) {
    const fileIds = folderToFiles.get(folder) ?? []
    folderNodes.push({
      data: {
        id: folderNodeId(folder),
        kind: 'folder',
        label: folderLabel(folder),
        title: `${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`,
        folder,
        tags: fileIds,
        isFolder: true,
      },
    })
  }

  // Filter keywords by document frequency and create keyword nodes
  const keywordNodes: CytoscapeNode[] = []
  for (const [keyword, fileIds] of keywordToFiles.entries()) {
    const df = keywordDocFreq.get(keyword) || 0
    if (df < MIN_KEYWORD_DF) continue // Skip rare keywords

    keywordNodes.push({
      data: {
        id: `keyword:${keyword}`,
        kind: 'keyword',
        label: keyword,
        title: `${fileIds.size} file${fileIds.size === 1 ? '' : 's'}`,
        tags: Array.from(fileIds),
      },
    })
  }

  // Build edges
  const edges: CytoscapeEdge[] = []
  let edgeIndex = 0

  // Folder -> file edges
  for (const [folder, fileIds] of folderToFiles.entries()) {
    const folderId = folderNodeId(folder)
    for (const fileId of fileIds) {
      edges.push({
        data: {
          id: `folder:${edgeIndex++}`,
          source: folderId,
          target: fileId,
          kind: 'cofolder',
        },
      })
    }
  }

  // Keyword -> file edges (only for keywords meeting DF threshold)
  for (const [keyword, fileIds] of keywordToFiles.entries()) {
    const df = keywordDocFreq.get(keyword) || 0
    if (df < MIN_KEYWORD_DF) continue

    const keywordNodeId = `keyword:${keyword}`
    for (const fileId of fileIds) {
      edges.push({
        data: {
          id: `tagged:${edgeIndex++}`,
          source: keywordNodeId,
          target: fileId,
          kind: 'tagged',
        },
      })
    }
  }

  // Topic tree edges: each folder points at its parent, so the mindmap can
  // render programming -> python instead of a flat root -> everything list.
  // An explicit override wins over the directory-nesting parent.
  for (const folder of allFolders) {
    if (folder === ROOT_FOLDER) continue
    const ancestors = ancestorFolders(folder)
    const naturalParent =
      ancestors.length > 0 ? (ancestors[ancestors.length - 1] as string) : ROOT_FOLDER
    const parent = overrides.parents[folder] ?? naturalParent
    edges.push({
      data: {
        id: `tree:${edgeIndex++}`,
        source: folderNodeId(parent),
        target: folderNodeId(folder),
        kind: 'tree',
      },
    })
  }

  return {
    nodes: [...fileNodes, ...keywordNodes, ...folderNodes],
    edges,
  }
}
// #endregion Graph Builder

// #region Layout Precomputation
const LAYOUT_TIMEOUT_MS = 120_000

/**
 * Compute node positions headlessly, so the viewer can use the instant
 * preset layout instead of running cose on the main thread. Coordinates are
 * rounded to integers to keep graph.json small. The timeout race takes
 * whatever positions exist rather than hanging the build.
 */
export async function computeLayoutPositions(
  elements: CytoscapeElements
): Promise<Record<string, NodePosition>> {
  const cy = cytoscape({
    elements: {
      nodes: elements.nodes.map((n) => ({ data: { id: n.data.id } })),
      edges: elements.edges.map((e) => ({
        data: { id: e.data.id, source: e.data.source, target: e.data.target },
      })),
    },
    headless: true,
    styleEnabled: false,
  })
  try {
    const layout = cy.layout({ name: 'cose', animate: false })
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LAYOUT_TIMEOUT_MS)
      layout.one('layoutstop', () => {
        clearTimeout(timer)
        resolve()
      })
      layout.run()
    })
    const positions: Record<string, NodePosition> = {}
    for (const node of elements.nodes) {
      const pos = cy.getElementById(node.data.id).position()
      positions[node.data.id] = { x: Math.round(pos.x), y: Math.round(pos.y) }
    }
    return positions
  } finally {
    cy.destroy()
  }
}

/**
 * Attach precomputed positions to nodes missing them. Never overwrites an
 * existing position, so hand-placed coordinates survive rebuilds.
 */
export function applyLayoutPositions(
  elements: CytoscapeElements,
  positions: Record<string, NodePosition>
): void {
  for (const node of elements.nodes) {
    if (node.position) continue
    const pos = positions[node.data.id]
    if (pos) node.position = { x: pos.x, y: pos.y }
  }
}
// #endregion Layout Precomputation

// #region File Operations
async function writeGraphJson(elements: CytoscapeElements): Promise<Result<void, Error>> {
  return from(
    (async () => {
      const json = JSON.stringify(elements, null, 2)
      await writeFile(OUTPUT_FILE, json, 'utf-8')
    })()
  )
}
// #endregion File Operations

// #region Main Build Flow
async function main(): Promise<void> {
  logger.info(`[build-graph] Scanning markdown files in: ${SOURCE_DIR}`)

  const walkResult = await walkMarkdownFiles(SOURCE_DIR)
  if (!walkResult.ok) {
    logger.error('[build-graph] Failed to walk directory:', walkResult.error)
    process.exit(1)
  }

  const files = walkResult.value
  logger.info(`[build-graph] Found ${files.length} markdown files`)

  const overrides = await loadParentOverrides()
  const elements = buildElements(files, overrides)
  const fileCount = elements.nodes.filter((n) => n.data.kind === 'file').length
  const keywordCount = elements.nodes.filter((n) => n.data.kind === 'keyword').length
  logger.success(
    `[build-graph] Built graph: ${fileCount} files, ${keywordCount} keywords, ${elements.edges.length} edges`
  )

  // Build semantic hierarchies (Mode A: Topic Clusters, Mode B: Full Hierarchy)
  logger.info('[build-graph] Building semantic hierarchies...')
  const semanticResult = await buildSemanticHierarchies(files)
  if (semanticResult.ok) {
    const { topicClusters, fullHierarchy } = semanticResult.value

    // Convert to Cytoscape elements and merge
    const topicElements = hierarchyToCytoscape(topicClusters, 'topic-clusters')
    const fullElements = hierarchyToCytoscape(fullHierarchy, 'full-hierarchy')

    // Merge nodes (avoid duplicates by id)
    const existingNodeIds = new Set(elements.nodes.map((n) => n.data.id))
    for (const node of [...topicElements.nodes, ...fullElements.nodes]) {
      if (!existingNodeIds.has(node.data.id)) {
        elements.nodes.push(node)
        existingNodeIds.add(node.data.id)
      }
    }

    // Merge edges
    const existingEdgeIds = new Set(elements.edges.map((e) => e.data.id))
    for (const edge of [...topicElements.edges, ...fullElements.edges]) {
      if (!existingEdgeIds.has(edge.data.id)) {
        elements.edges.push(edge)
        existingEdgeIds.add(edge.data.id)
      }
    }

    logger.success(
      `[build-graph] Added semantic: ${topicElements.nodes.length + fullElements.nodes.length} nodes, ${topicElements.edges.length + fullElements.edges.length} edges`
    )
  } else {
    logger.warn(`[build-graph] Semantic hierarchy build failed: ${semanticResult.error.message}`)
  }

  const layoutStart = Date.now()
  applyLayoutPositions(elements, await computeLayoutPositions(elements))
  logger.success(
    `[build-graph] Laid out ${elements.nodes.length} nodes in ${Date.now() - layoutStart}ms`
  )

  const writeResult = await writeGraphJson(elements)
  if (!writeResult.ok) {
    logger.error('[build-graph] Failed to write graph.json:', writeResult.error)
    process.exit(1)
  }

  logger.success(`[build-graph] Wrote graph to: ${OUTPUT_FILE}`)
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main()
}
// #endregion Main Build Flow
