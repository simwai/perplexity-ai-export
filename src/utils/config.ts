import { config as loadEnv } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
    .transform((val) => val === 'true'),
  headless: z.union([z.boolean(), z.literal('new')]),
  debug: z.boolean(),
  debugMode: z.boolean(),
})

export type Config = z.infer<typeof configSchema>
export type WaitMode = Config['waitMode']

function parseEnvConfig(): Config {
  const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
  const DEFAULT_RATE_LIMIT_MS = '500'
  const DEFAULT_PARALLEL_WORKERS = '5'
  const DEFAULT_CHECKPOINT_INTERVAL = '10'

  const rawHeadlessValue = process.env['HEADLESS'] ?? 'false'
  let headless: boolean | 'new' = false
  if (rawHeadlessValue === 'true') {
    headless = true
  } else if (rawHeadlessValue === 'new') {
    headless = 'new'
  }

  const rawConfig = {
    authStoragePath: process.env['AUTH_STORAGE_PATH'] ?? join('.storage', 'auth.json'),
    waitMode: process.env['WAIT_MODE'] ?? 'dynamic',
    rateLimitMs: parseInt(process.env['RATE_LIMIT_MS'] ?? DEFAULT_RATE_LIMIT_MS, 10),
    parallelWorkers: parseInt(process.env['PARALLEL_WORKERS'] ?? DEFAULT_PARALLEL_WORKERS, 10),
    checkpointSaveInterval: parseInt(
      process.env['CHECKPOINT_SAVE_INTERVAL'] ?? DEFAULT_CHECKPOINT_INTERVAL,
      10
    ),
    exportDir: process.env['EXPORT_DIR'] ?? 'exports',
    checkpointPath: process.env['CHECKPOINT_PATH'] ?? join('.storage', 'checkpoint.json'),
    vectorIndexPath: process.env['VECTOR_INDEX_PATH'] ?? join('.storage', 'vector-index'),
    ollamaUrl: process.env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL,
    ollamaModel: process.env['OLLAMA_MODEL'] ?? 'llama3.1',
    ollamaEmbedModel: process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text',
    enableVectorSearch: process.env['ENABLE_VECTOR_SEARCH'],
    headless: headless,
    debug: process.env['DEBUG'] === 'true',
    debugMode: process.env['DEBUG_MODE'] === 'true' || process.env['DIAGNOSIS_MODE'] === 'true',
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    logger.error('Invalid configuration detected:')
    result.error.issues.forEach((issue) => {
      const fieldPath = issue.path.join('.')
      const envVarName = camelToSnakeCase(fieldPath).toUpperCase()
      logger.error(`  ${envVarName}: ${issue.message}`)
    })
    logger.error('\nPlease check your .env file and fix the above errors.')
    process.exit(1)
  }

  return result.data
}

function camelToSnakeCase(camelStr: string): string {
  return camelStr.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function ensureDirectoryExistsForFile(filePath: string): void {
  const dirPath = dirname(filePath)
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export const config: Config = parseEnvConfig()

ensureDirectoryExistsForFile(config.authStoragePath)
ensureDirectoryExistsForFile(config.checkpointPath)
ensureDirectoryExistsForFile(config.vectorIndexPath)

if (!existsSync(config.exportDir)) {
  mkdirSync(config.exportDir, { recursive: true })
}
