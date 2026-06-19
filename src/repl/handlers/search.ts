import { BaseHandler } from './base.js'
import { input, select, confirm } from '@inquirer/prompts'
import { logger } from '../../utils/logger.js'
import { errorBus } from '../../utils/error-bus.js'

export class SearchHandler extends BaseHandler {
  async handleSearchWizard(): Promise<void> {
    try {
      const userSearchQuery = await input({
        message: 'Search query:',
        validate: (inputValue) => inputValue.trim().length > 0 || 'Please enter a query.',
      })

      let selectedSearchMode = (await select({
        message: 'Search mode:',
        choices: [
          { name: 'Auto (semantic for long queries, exact for short)', value: 'auto' },
          { name: 'Semantic (Ollama + Vectra)', value: 'vector' },
          { name: 'RAG (Ask history with Ollama)', value: 'rag' },
          { name: 'Exact text (ripgrep)', value: 'rg' },
        ],
        default: 'auto',
      })) as any

      const isSemanticSearchRequested = selectedSearchMode !== 'rg'
      if (isSemanticSearchRequested) {
        try {
          await this.searchOrchestrator.validateVectorSearch()
        } catch (validationError) {
          if (selectedSearchMode === 'auto') {
            logger.warn('Ollama not available. Falling back to Exact Text search.')
            selectedSearchMode = 'rg'
          } else {
            return
          }
        }
      }

      await this.searchOrchestrator.search(userSearchQuery, selectedSearchMode, {
        pattern: userSearchQuery,
      })
    } catch (wizardError) {
      errorBus.emitError('Search wizard failed', wizardError)
    }
  }

  async handleVectorizeWizard(): Promise<void> {
    try {
      const shouldRebuildIndexNow = await confirm({
        message: 'Rebuild the vector index from exports now?',
        default: true,
      })

      if (!shouldRebuildIndexNow) {
        return
      }

      await this.searchOrchestrator.validateVectorSearch()
      await this.searchOrchestrator.vectorizeNow()
    } catch (vectorizationError) {
      errorBus.emitError('Vectorization wizard failed', vectorizationError)
    }
  }
}
