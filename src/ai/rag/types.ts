import { type VectorSearchResult } from '../../search/vector-store.js'

export interface ResearchPlan {
  strategy: 'precise' | 'exhaustive'
  queries: string[]
  hardKeywords: string[]
  hydePassage: string
  filters: Record<string, any>
}

export interface ExtractedFact {
  fact: string
  source_title: string
  thread: string
}

export interface RagStepContext {
  question: string
  plan?: ResearchPlan
  searchResults?: VectorSearchResult[]
  facts?: ExtractedFact[]
  answer?: string
}
