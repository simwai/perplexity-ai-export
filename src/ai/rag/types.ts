import { type VectorSearchResult } from '../../search/vector-store.js'

export interface ResearchPlan {
  researchStrategy: 'precise' | 'exhaustive'
  searchQueries: string[]
  hardKeywordsForExactMatch: string[]
  hypotheticalDocumentEmbeddingsPassage: string
  metadataFilters: Record<string, any>
}

export interface ExtractedFact {
  factContent: string
  sourceDocumentTitle: string
  conversationThreadTitle: string
}

export interface RagProcessingStepState {
  originalUserQuestion: string
  developedResearchPlan?: ResearchPlan
  retrievedSearchResults?: VectorSearchResult[]
  extractedResearchFacts?: ExtractedFact[]
  generatedFinalAnswer?: string
}
