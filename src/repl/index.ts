import { errorBus } from '../utils/error-bus.js'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import { logger } from '../utils/logger.js'
import { CommandHandler } from './commands.js'
import { type Config } from '../utils/config.js'

export class Repl {
  private activeCommandHandler: CommandHandler
  private isReplRunning = true

  constructor(config: Config) {
    this.activeCommandHandler = new CommandHandler(config)
  }

  async start(): Promise<void> {
    logger.info(chalk.bold.cyan('\n🔮 Perplexity History Export Tool\n'))
    logger.info('Select commands to execute. Press Ctrl+C to exit.\n')

    while (this.isReplRunning) {
      try {
        const selectedCommand = await select({
          message: 'perplexity>',
          choices: [
            { name: 'Start scraper (Library)', value: 'start-library' },
            { name: 'Search conversations', value: 'search' },
            { name: 'Build vector index', value: 'vectorize' },
            { name: 'Reset all data', value: 'reset' },
            { name: 'Help', value: 'help' },
            { name: 'Exit', value: 'exit' },
          ],
        })

        await this.executeReplCommand(selectedCommand)
      } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
          this.terminateRepl()
        } else {
          throw error
        }
      }
    }
  }

  private async executeReplCommand(command: string): Promise<void> {
    switch (command) {
      case 'start-library':
        await this.activeCommandHandler.handleScraperWizard()
        break
      case 'search':
        await this.activeCommandHandler.handleSearchWizard()
        break
      case 'vectorize':
        await this.activeCommandHandler.handleVectorizeWizard()
        break
      case 'reset':
        await this.activeCommandHandler.handleDataReset()
        break
      case 'help':
        this.activeCommandHandler.handleShowHelp()
        break
      case 'exit':
        this.terminateRepl()
        break
      default:
        errorBus.emitError(`Unknown command: ${command}`)
        this.activeCommandHandler.handleShowHelp()
    }
  }

  private terminateRepl(): void {
    if (!this.isReplRunning) return
    this.isReplRunning = false
    logger.info(chalk.cyan('\n👋 Goodbye!\n'))
    process.exit(0)
  }
}
