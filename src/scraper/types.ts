export interface Conversation {
  id: string
  title: string
  spaceName: string
  timestamp: Date
  content: string
}

export interface Checkpoint {
  processedIds: string[]
  lastScrollPosition: number
  completedAt: string | null
  totalProcessed: number
}
