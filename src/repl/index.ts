import { errorBus } from '../utils/error-bus.js'
import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import { logger } from '../utils/logger.js'
import { CommandHandler } from './commands.js'
import { type Config } from '../utils/config.js'

export class Repl {
  private readonly commandHandler: CommandHandler
  private isRunning = true

  constructor(config: Config) {
    this.commandHandler = new CommandHandler(config)
  }

  async start(): Promise<void> {
    logger.info(chalk.bold.cyan('\n🔮 Perplexity History Export Tool\n'))
    logger.info('Select commands to execute. Press Ctrl+C to exit.\n')

    while (this.isRunning) {
      try {
        const selectedAction = await select({
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

        await this.dispatchCommand(selectedAction)
      } catch (error) {
        const isUserExit = error instanceof Error && error.name === 'ExitPromptError'
        if (isUserExit) {
          this.terminate()
        } else {
          throw error
        }
      }
    }
  }

  private async dispatchCommand(actionValue: string): Promise<void> {
    switch (actionValue) {
      case 'start-library':
        await this.commandHandler.handleScraperWizard()
        break
      case 'search':
        await this.commandHandler.handleSearchWizard()
        break
      case 'vectorize':
        await this.commandHandler.handleVectorizeWizard()
        break
      case 'reset':
        await this.commandHandler.handleDataReset()
        break
      case 'help':
        this.commandHandler.handleShowHelp()
        break
      case 'exit':
        this.terminate()
        break
      default:
        errorBus.emitError(`Unknown action: ${actionValue}`)
        this.commandHandler.handleShowHelp()
    }
  }

  private terminate(): void {
    if (!this.isRunning) return
    this.isRunning = false
    logger.info(chalk.cyan('\n👋 Goodbye!\n'))
    process.exit(0)
  }
}
