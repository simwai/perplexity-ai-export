import chalk from 'chalk'
import { logger } from '../utils/logger.js'

export function showHelp(): void {
  const logAction = (actionName: string, actionDescription: string) => {
    logger.info(chalk.cyan(`  ${actionName}`))
    logger.info(`    ${actionDescription}\n`)
  }

  logger.info(chalk.bold('\n📚 Available Actions:\n'))

  logAction(
    'Start scraper (Library)',
    'Run the scraper to export your Perplexity history. If a checkpoint exists, you can resume or restart.'
  )

  logAction(
    'Search conversations',
    'Search through exported conversations using various modes: auto, semantic, RAG, or exact text.'
  )

  logAction(
    'Build vector index',
    'Build or update the local vector index from your exports to enable semantic search and RAG.'
  )

  logAction(
    'Reset all data',
    'Remove all stored checkpoints, authentication data, and the vector index to start fresh.'
  )

  logAction('Help', 'Display this help overview.')

  logAction('Exit', 'Close the application.')

  logger.info(chalk.bold('💡 Search & RAG Tips:\n'))
  logger.info(
    '  • RAG: Ask history with Ollama. Combines vector retrieval with AI generation for comprehensive answers.'
  )
  logger.info(
    '    The pipeline now includes HyDE (generates a hypothetical answer passage before searching)'
  )
  logger.info(
    '    and cross-encoder reranking (rescores top candidates for higher precision) automatically.'
  )
  logger.info(
    '  • Auto Search: Intelligently switches between semantic and exact search based on query length.'
  )
  logger.info(
    '  • Semantic: Best for finding conceptually similar topics even without exact keyword matches.'
  )
  logger.info('  • Exact: Ideal for finding specific phrases or technical terms.\n')

  logger.info(chalk.bold('🏋️  Benchmark:\n'))
  logger.info(
    '  Run npm run benchmark to measure RAG pipeline latency across a set of test queries.'
  )
  logger.info(
    '  Requires a built vector index. Edit BENCHMARK_QUERIES in src/benchmark.ts to tailor to your history.\n'
  )
}
