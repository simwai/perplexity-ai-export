import { errorBus } from '../utils/error-bus.js'
import { select } from '@inquirer/prompts'
import { logger } from '../utils/logger.js'
import { CommandHandler } from './commands.js'
import { type Config } from '../utils/config.js'
import { from } from 'super-result'

export class Repl {
  private readonly commandHandler: CommandHandler
  private isRunning = true

  constructor(config: Config) {
    this.commandHandler = new CommandHandler(config)
  }

  async start(): Promise<void> {
    logger.info('\n🔮 Perplexity History Export Tool\n')
    logger.info('Select commands to execute. Press Ctrl+C to exit.\n')

    while (this.isRunning) {
      const selectResult = await from<string>(
        async () =>
          await select({
            message: 'perplexity>',
            choices: [
              { name: 'Start scraper (Library)', value: 'start-library' },
              { name: 'Search conversations', value: 'search' },
              { name: 'Chat with history', value: 'chat' },
              { name: 'Build vector index', value: 'vectorize' },
              { name: 'Reset all data', value: 'reset' },
              { name: 'Help', value: 'help' },
              { name: 'Exit', value: 'exit' },
            ],
          })
      )

      if (!selectResult.ok) {
        const isUserExit =
          selectResult.error instanceof Error && selectResult.error.name === 'ExitPromptError'
        if (isUserExit) {
          this.terminate()
        } else {
          errorBus.emitError('Command selection failed', selectResult.error)
        }
        continue
      }

      await this.dispatchCommand(selectResult.value)
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
      case 'chat':
        await this.commandHandler.handleChatWizard()
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
    logger.info('\n👋 Goodbye!\n')
  }
}
