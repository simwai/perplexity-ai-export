import chalk from 'chalk'
import { logger } from '../utils/logger.js'

export function showHelp(): void {
  logger.info(chalk.bold('\n📚 Available Actions:\n'))

  logger.info(chalk.cyan('  start'))
  logger.info('    Run the scraper. If a checkpoint exists, you can resume or restart.\n')

  logger.info(chalk.cyan('  search'))
  logger.info('    Search exported conversations (choose mode: auto / semantic / exact).\n')

  logger.info(chalk.cyan('  vectorize'))
  logger.info('    Build or rebuild the local vector index from exports using Ollama.\n')

  logger.info(chalk.cyan('  reset'))
  logger.info('    Delete all stored checkpoints, authentication data, and vector index.\n')

  logger.info(chalk.cyan('  help'))
  logger.info('    Show this help message.\n')

  logger.info(chalk.cyan('  exit'))
  logger.info('    Exit the tool.\n')

  logger.info(chalk.bold('💡 Tips:\n'))
  logger.info('  • Use auto mode for natural language questions.')
  logger.info('  • Use semantic search when you want fuzzy matches.')
  logger.info('  • Use exact search for precise string matches.\n')
}
