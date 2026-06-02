import { errorBus } from '../utils/error-bus.js'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import { logger } from '../utils/logger.js'
import { CommandHandler } from './commands.js'
import { type Config } from '../utils/config.js'

export class Repl {
  private readonly applicationCommandHandler: CommandHandler
  private isApplicationRunning = true

  constructor(applicationConfig: Config) {
    this.applicationCommandHandler = new CommandHandler(applicationConfig)
  }

  async start(): Promise<void> {
    logger.info(chalk.bold.cyan('\n🔮 Perplexity History Export Tool\n'))
    logger.info('Select commands to execute. Press Ctrl+C to exit.\n')

    while (this.isApplicationRunning) {
      try {
        const userSelectedAction = await select({
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

        await this.dispatchSelectedCommand(userSelectedAction)
      } catch (interactionError) {
        const isUserIntentionalExit = interactionError instanceof Error && interactionError.name === 'ExitPromptError'
        if (isUserIntentionalExit) {
          this.terminateApplication()
        } else {
          throw interactionError
        }
      }
    }
  }

  private async dispatchSelectedCommand(commandValue: string): Promise<void> {
    switch (commandValue) {
      case 'start-library':
        await this.applicationCommandHandler.handleScraperWizard()
        break
      case 'search':
        await this.applicationCommandHandler.handleSearchWizard()
        break
      case 'vectorize':
        await this.applicationCommandHandler.handleVectorizeWizard()
        break
      case 'reset':
        await this.applicationCommandHandler.handleDataReset()
        break
      case 'help':
        this.applicationCommandHandler.handleShowHelp()
        break
      case 'exit':
        this.terminateApplication()
        break
      default:
        errorBus.emitError(`Unknown command action: ${commandValue}`)
        this.applicationCommandHandler.handleShowHelp()
    }
  }

  private terminateApplication(): void {
    if (!this.isApplicationRunning) {
      return
    }
    this.isApplicationRunning = false
    logger.info(chalk.cyan('\n👋 Goodbye!\n'))
    process.exit(0)
  }
}
