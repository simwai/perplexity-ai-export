import chalk from 'chalk'
import { logger } from '../utils/logger.js'

export function showHelp(): void {
  logger.info(chalk.bold('\n📚 Available Actions:\n'))

  logger.info(chalk.cyan('  start'))
  logger.info(
    '    Run the scraper to export your Perplexity history. If a checkpoint exists, you can resume or restart.\n'
  )

  logger.info(chalk.cyan('  search'))
  logger.info(
    '    Search through exported conversations using various modes: auto, semantic, RAG, or exact text.\n'
  )

  logger.info(chalk.cyan('  vectorize'))
  logger.info(
    '    Build or update the local vector index from your exports to enable semantic search and RAG.\n'
  )

  logger.info(chalk.cyan('  reset'))
  logger.info(
    '    Remove all stored checkpoints, authentication data, and the vector index to start fresh.\n'
  )

  logger.info(chalk.cyan('  help'))
  logger.info('    Display this help overview.\n')

  logger.info(chalk.cyan('  exit'))
  logger.info('    Close the application.\n')

  logger.info(chalk.bold('💡 Search & RAG Tips:\n'))
  logger.info(
    '  • RAG: Ask history with Ollama. Combines vector retrieval with AI generation for comprehensive answers.'
  )
  logger.info(
    '  • Auto Search: Intelligently switches between semantic and exact search based on query length.'
  )
  logger.info(
    '  • Semantic: Best for finding conceptually similar topics even without exact keyword matches.'
  )
  logger.info('  • Exact: Ideal for finding specific phrases or technical terms.\n')
}
