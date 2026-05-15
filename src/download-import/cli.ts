import { bundlePerplexityDownloads } from './perplexity-download-bundler.js'

function parseArgs(argv: string[]): {
  inputs: string[]
  titlePrefix: string
  outPath: string
  threadId?: string
  title?: string
} {
  const inputs: string[] = []
  let titlePrefix = ''
  let outPath = 'exports-downloads/perplexity-download.itir.perplexity.json'
  let threadId: string | undefined
  let title: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--input' && next) {
      inputs.push(next)
      i++
    } else if (arg === '--title-prefix' && next) {
      titlePrefix = next
      i++
    } else if (arg === '--out' && next) {
      outPath = next
      i++
    } else if (arg === '--thread-id' && next) {
      threadId = next
      i++
    } else if (arg === '--title' && next) {
      title = next
      i++
    } else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  if (inputs.length === 0) {
    throw new Error('Provide at least one --input file or directory.')
  }

  if (!titlePrefix) {
    throw new Error('Provide --title-prefix so unrelated Markdown files are not bundled.')
  }

  return {
    inputs,
    titlePrefix,
    outPath,
    threadId,
    title,
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run bundle:perplexity-downloads -- [options]

Options:
  --input <path>          File or directory to scan. Repeatable.
  --title-prefix <text>   Download filename prefix to match.
  --out <path>            Output .itir.perplexity.json path.
  --thread-id <id>        Stable source thread id for the bundle.
  --title <text>          Archive thread title.
`)
}

try {
  const summary = bundlePerplexityDownloads(parseArgs(process.argv.slice(2)))
  console.log(`Wrote ${summary.outPath}`)
  console.log(`Source files: ${summary.sourceFiles}`)
  console.log(`Parsed turns: ${summary.parsedTurns}`)
  console.log(`Unique turns: ${summary.uniqueTurns}`)
  console.log(`Messages: ${summary.messages}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
