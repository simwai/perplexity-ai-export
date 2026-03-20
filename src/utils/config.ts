import { config as loadEnv } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { logger } from './logger.js'

loadEnv()

const configSchema = z.object({
  authStoragePath: z.string().min(1),
  waitMode: z.enum(['dynamic', 'static']),
  rateLimitMs: z.number().int().positive(),
  parallelWorkers: z.number().int().min(1).max(20),
  checkpointSaveInterval: z.number().int().positive(),
  exportDir: z.string().min(1),
  checkpointPath: z.string().min(1),
  vectorIndexPath: z.string().min(1),
  ollamaUrl: z.string().url(),
  ollamaModel: z.string().min(1),
  ollamaEmbedModel: z.string().min(1),
  enableVectorSearch: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
})

export type Config = z.infer<typeof configSchema>
export type WaitMode = Config['waitMode']

function parseEnvConfig(): Config {
  const defaultOllamaUrl = 'http://localhost:11434'
  const defaultRateLimitMs = '500'
  const defaultParallelWorkers = '5'
  const defaultCheckpointInterval = '10'

  const rawConfig = {
    authStoragePath: process.env['AUTH_STORAGE_PATH'] ?? '.storage/auth.json',
    waitMode: process.env['WAIT_MODE'] ?? 'dynamic',
    rateLimitMs: parseInt(process.env['RATE_LIMIT_MS'] ?? defaultRateLimitMs, 10),
    parallelWorkers: parseInt(process.env['PARALLEL_WORKERS'] ?? defaultParallelWorkers, 10),
    checkpointSaveInterval: parseInt(process.env['CHECKPOINT_SAVE_INTERVAL'] ?? defaultCheckpointInterval, 10),
    exportDir: process.env['EXPORT_DIR'] ?? 'exports',
    checkpointPath: process.env['CHECKPOINT_PATH'] ?? '.storage/checkpoint.json',
    vectorIndexPath: process.env['VECTOR_INDEX_PATH'] ?? '.storage/vector-index',
    ollamaUrl: process.env['OLLAMA_URL'] ?? defaultOllamaUrl,
    ollamaModel: process.env['OLLAMA_MODEL'] ?? 'llama3.1',
    ollamaEmbedModel: process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text',
    enableVectorSearch: process.env['ENABLE_VECTOR_SEARCH'],
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    logger.error('Invalid configuration detected:')
    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.')
      const envVar = camelToSnakeCase(path).toUpperCase()
      logger.error(`  ${envVar}: ${issue.message}`)
    })
    logger.error('\nPlease check your .env file and fix the above errors.')
    process.exit(1)
  }

  return result.data
}

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
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
