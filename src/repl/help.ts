import chalk from 'chalk'
import { logger } from '../utils/logger.js'

export function showHelp(): void {
  const logHelpAction = (actionLabel: string, actionDescriptionText: string) => {
    logger.info(chalk.cyan(`  ${actionLabel}`))
    logger.info(`    ${actionDescriptionText}\n`)
  }

  logger.info(chalk.bold('\n📚 Available Actions:\n'))

  logHelpAction(
    'Start scraper (Library)',
    'Run the scraper to export your Perplexity history. If a checkpoint exists, you can resume or restart.'
  )

  logHelpAction(
    'Search conversations',
    'Search through exported conversations using various modes: auto, semantic, RAG, or exact text.'
  )

  logHelpAction(
    'Build vector index',
    'Build or update the local vector index from your exports to enable semantic search and RAG.'
  )

  logHelpAction(
    'Reset all data',
    'Remove all stored checkpoints, authentication data, and the vector index to start fresh.'
  )

  logHelpAction('Help', 'Display this help overview.')

  logHelpAction('Exit', 'Close the application.')

  logger.info(chalk.bold('💡 Search & RAG Tips:\n'))
  logger.info(
    '  • RAG: Ask history with Ollama. Combines vector retrieval with AI generation for comprehensive answers.'
  )
  logger.info(
    '    The pipeline now includes HyDE (hypothetical embeddings) and cross-encoder reranking.'
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
}
