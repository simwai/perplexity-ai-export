import { config as loadEnv } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { logger } from './logger.js'

loadEnv()

const configSchema = z.object({
  authStoragePath: z.string().min(1),
  waitMode: z.enum(['dynamic', 'static']),
  discoveryMode: z.enum(['api', 'scroll', 'interaction', 'ai']),
  extractionMode: z.enum(['api', 'dom', 'native', 'ai']),
  rateLimitMs: z.number().int().positive(),
  parallelWorkers: z.number().int().min(1).max(20),
  checkpointSaveInterval: z.number().int().positive(),
  exportDir: z.string().min(1),
  checkpointPath: z.string().min(1),
  vectorIndexPath: z.string().min(1),

  // AI Configuration
  llmSource: z.enum(['ollama', 'openrouter']),
  llmRagModel: z.string().min(1),
  llmVisionModel: z.string().min(1),
  llmEmbedModel: z.string().min(1),
  ollamaUrl: z.string().url(),
  openrouterApiKey: z.string().optional(),

  enableVectorSearch: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  headless: z.union([z.boolean(), z.literal('new')]),
})

export type Config = z.infer<typeof configSchema>
export type WaitMode = Config['waitMode']

function parseEnvConfig(): Config {
  const defaultOllamaUrl = 'http://localhost:11435'
  const defaultRateLimitMs = '500'
  const defaultParallelWorkers = '5'
  const defaultCheckpointInterval = '10'

  const rawHeadless = process.env['HEADLESS'] ?? 'false'
  let headlessValue: boolean | 'new' = true
  if (rawHeadless === 'false') {
    headlessValue = false
  } else if (rawHeadless === 'new') {
    headlessValue = 'new'
  }

  const llmSource: 'ollama' | 'openrouter' = (process.env['LLM_SOURCE'] as any) ?? 'ollama'

  // Default models change based on source if not explicitly provided
  const defaultRagModel = llmSource === 'openrouter' ? 'stepfun/step-3.5-flash:free' : 'cogito'
  const defaultVisionModel = llmSource === 'openrouter' ? 'stepfun/step-3.5-flash:free' : 'ministral-3'

  const rawConfig = {
    authStoragePath: process.env['AUTH_STORAGE_PATH'] ?? join('.storage', 'auth.json'),
    waitMode: process.env['WAIT_MODE'] ?? 'dynamic',
    discoveryMode: process.env['DISCOVERY_MODE'] ?? 'api',
    extractionMode: process.env['EXTRACTION_MODE'] ?? 'api',
    rateLimitMs: parseInt(process.env['RATE_LIMIT_MS'] ?? defaultRateLimitMs, 10),
    parallelWorkers: parseInt(process.env['PARALLEL_WORKERS'] ?? defaultParallelWorkers, 10),
    checkpointSaveInterval: parseInt(
      process.env['CHECKPOINT_SAVE_INTERVAL'] ?? defaultCheckpointInterval,
      10
    ),
    exportDir: process.env['EXPORT_DIR'] ?? 'exports',
    checkpointPath: process.env['CHECKPOINT_PATH'] ?? join('.storage', 'checkpoint.json'),
    vectorIndexPath: process.env['VECTOR_INDEX_PATH'] ?? join('.storage', 'vector-index'),

    // AI
    llmSource,
    llmRagModel: process.env['LLM_RAG_MODEL'] ?? defaultRagModel,
    llmVisionModel: process.env['LLM_VISION_MODEL'] ?? defaultVisionModel,
    llmEmbedModel: process.env['LLM_EMBED_MODEL'] ?? 'nomic-embed-text',
    ollamaUrl: process.env['OLLAMA_URL'] ?? defaultOllamaUrl,
    openrouterApiKey: process.env['OPENROUTER_API_KEY'],

    enableVectorSearch: process.env['ENABLE_VECTOR_SEARCH'],
    headless: headlessValue,
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    logger.error('Invalid configuration detected:')
    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.')
      logger.error(`  ${path.toUpperCase()}: ${issue.message}`)
    })
    logger.error('\nPlease check your .env file and fix the above errors.')
    process.exit(1)
  }

  return result.data
}

function ensureDirectory(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export const config: Config = parseEnvConfig()

ensureDirectory(config.authStoragePath)
ensureDirectory(config.checkpointPath)
ensureDirectory(config.vectorIndexPath)

if (!existsSync(config.exportDir)) {
  mkdirSync(config.exportDir, { recursive: true })
}
