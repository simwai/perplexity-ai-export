import { BaseHandler } from './base.js'
import { input, select, confirm } from '@inquirer/prompts'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'

export class SearchHandler extends BaseHandler {
  async handleSearchWizard(): Promise<void> {
    const query = await input({
      message: 'Search query:',
      validate: (v) => v.trim().length > 0 || 'Please enter a query.',
    })

    let mode = await select({
      message: 'Search mode:',
      choices: [
        { name: 'Auto (semantic for long queries, exact for short)', value: 'auto' },
        { name: 'Semantic (Ollama + Vectra)', value: 'vector' },
        { name: 'RAG (Ask history with Ollama)', value: 'rag' },
        { name: 'Exact text (ripgrep)', value: 'rg' },
      ],
      default: 'auto',
    }) as any

    try {
      if (mode !== 'rg') {
        try {
          await this.searchOrchestrator.validateVectorSearch()
        } catch (error) {
          if (mode === 'auto') {
            logger.warn('Ollama not available. Falling back to Exact Text search.')
            mode = 'rg'
          } else {
            errorBus.emitError(error instanceof Error ? error.message : String(error))
            return
          }
        }
      }

      await this.searchOrchestrator.search(query, mode, { pattern: query })
    } catch (error) {
      errorBus.emitError('Search failed', error)
    }
  }

  async handleVectorizeWizard(): Promise<void> {
    const shouldRebuild = await confirm({ message: 'Rebuild the vector index from exports now?', default: true })
    if (!shouldRebuild) return

    try {
      await this.searchOrchestrator.validateVectorSearch()
      await this.searchOrchestrator.vectorizeNow()
    } catch (error) {
      errorBus.emitError('Vectorization failed', error)
    }
  }
}
