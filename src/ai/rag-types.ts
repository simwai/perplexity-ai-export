import { z } from 'zod'

export const researchPlanJsonSchema = z
  .object({
    strategy: z.enum(['precise', 'exhaustive']).optional(),
    queries: z.array(z.string()).optional(),
    hardKeywords: z.array(z.string()).optional(),
    hydePassage: z.string().optional(),
  })
  .passthrough()

export const extractedFactSchema = z.object({
  fact: z.string(),
  node_id: z.coerce.number().int().nonnegative(),
})

export const verificationResultSchema = z.object({
  status: z.enum(['ok', 'missed-info']),
  suggestion: z.string().optional(),
})

export interface ResearchPlan {
  originalQuestion: string
  strategy: 'precise' | 'exhaustive'
  queries: string[]
  hardKeywords: string[]
  hydePassage: string
}

export interface ExtractedFact {
  fact: string
  source_title: string
  thread: string
}

export class OrchestratorError extends Error {
  context?: Record<string, unknown>

  constructor(message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'OrchestratorError'
    this.context = context
  }
}
