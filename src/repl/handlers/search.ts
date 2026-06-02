import { BaseHandler } from './base.js'
import { input, select, confirm } from '@inquirer/prompts'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'

export class SearchHandler extends BaseHandler {
  async handleSearchWizard(): Promise<void> {
    try {
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

      if (mode !== 'rg') {
        try {
          await this.searchOrchestrator.validateVectorSearch()
        } catch (error) {
          if (mode === 'auto') {
            logger.warn('Ollama not available. Falling back to Exact Text search.')
            mode = 'rg'
          } else {
            return // errorBus.raiseError was called inside validateVectorSearch
          }
        }
      }

      await this.searchOrchestrator.search(query, mode, { pattern: query })
    } catch (error) {
      errorBus.emitError('Search wizard failed', error)
    }
  }

  async handleVectorizeWizard(): Promise<void> {
    try {
      const shouldRebuild = await confirm({ message: 'Rebuild the vector index from exports now?', default: true })
      if (!shouldRebuild) return

      await this.searchOrchestrator.validateVectorSearch()
      await this.searchOrchestrator.vectorizeNow()
    } catch (error) {
      errorBus.emitError('Vectorization wizard failed', error)
    }
  }
}
