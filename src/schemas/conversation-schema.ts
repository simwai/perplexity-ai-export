import { z } from 'zod'

// URL structure: https://www.perplexity.ai/search/find-out-the-most-significant-SX0iv3nWRAqbEck6vvQPbA
export const schema = z.object({
  uuid: z.string(),
  title: z.string(),
  link: z.string(),
  variant: z.string(),
  unread: z.boolean(),
  status: z.string(),
  context_uuid: z.string(),
  task_description: z.null(),
  answer_preview: z.null(),
})
