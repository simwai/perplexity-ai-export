import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import { logger } from '../utils/logger.js'
import { CommandHandler } from './commands.js'

export class Repl {
  private commandHandler: CommandHandler
  private isRunning = true

  constructor() {
    this.commandHandler = new CommandHandler()
  }

  async start(): Promise<void> {
    logger.info(chalk.bold.cyan('\n🔮 Perplexity History Export Tool\n'))
    logger.info('Select commands to execute. Press Ctrl+C to exit.\n')

    while (this.isRunning) {
      try {
        const command = await select({
          message: 'perplexity>',
          choices: [
            { name: 'Start scraper (Library)', value: 'start-library' },
            { name: 'Retry failed conversations', value: 'retry-failed' },
            { name: 'Search conversations', value: 'search' },
            { name: 'Build vector index', value: 'vectorize' },
            { name: 'Reset all data', value: 'reset' },
            { name: 'Help', value: 'help' },
            { name: 'Exit', value: 'exit' },
          ],
        })

        await this.processCommand(command)
      } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
          this.stop()
        } else {
          throw error
        }
      }
    }
  }

  private async processCommand(command: string): Promise<void> {
    switch (command) {
      case 'start-library':
        await this.commandHandler.handleStartLibrary()
        break
      case 'search':
        await this.commandHandler.handleSearchWizard()
        break
      case 'vectorize':
        await this.commandHandler.handleVectorizeWizard()
        break
      case 'reset':
        await this.commandHandler.handleReset()
        break
      case 'help':
        this.commandHandler.handleHelp()
        break
      case 'exit':
        this.stop()
        break
      default:
        logger.error(`Unknown command: ${command}`)
        this.commandHandler.handleHelp()
    }
  }

  private stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    logger.info(chalk.cyan('\n👋 Goodbye!\n'))
    process.exit(0)
  }
}
