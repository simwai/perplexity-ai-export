import { config as loadEnv } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { logger } from './logging/logger.js'
import { err, ok, type Result } from 'super-result'

const __dirname = dirname(fileURLToPath(import.meta.url))

const configSchema = z.object({
  authStoragePath: z.string().min(1),
  waitMode: z.enum(['dynamic', 'static']),
  rateLimitMs: z.number().int().positive(),
  parallelWorkers: z.number().int().min(1).max(20),
  extractionConcurrency: z.number().int().min(1).max(20),
  checkpointSaveInterval: z.number().int().positive(),
  exportDir: z.string().min(1),
  checkpointPath: z.string().min(1),
  vectorIndexPath: z.string().min(1),
  ollamaUrl: z.url(),
  ollamaModel: z.string().min(1),
  ollamaEmbedModel: z.string().min(1),
  aiProvider: z.enum(['ollama', 'openai-compatible']).default('ollama'),
  aiEmbedProvider: z.enum(['ollama', 'openai-compatible']).default('ollama'),
  aiBaseUrl: z.string().url().optional(),
  aiApiKey: z.string().min(1).optional(),
  aiModel: z.string().min(1).optional(),
  aiEmbedModel: z.string().min(1).optional(),
  enableVectorSearch: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  headless: z.union([z.boolean(), z.literal('new')]),
  debug: z.boolean(),
  hydeMode: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.enum(['off', 'fusion', 'supplement']).default('supplement')
  ),
  hydeThresholdScore: z.number(),
  hydeThresholdCount: z.number().int().nonnegative(),
  exportStrategies: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : ['markdown'])),
})

export type Config = z.infer<typeof configSchema>
export type WaitMode = Config['waitMode']

export interface EnvOverrides {
  HEADLESS?: string
  WAIT_MODE?: string
  RATE_LIMIT_MS?: string
  PARALLEL_WORKERS?: string
  EXTRACTION_CONCURRENCY?: string
  CHECKPOINT_SAVE_INTERVAL?: string
  EXPORT_DIR?: string
  CHECKPOINT_PATH?: string
  VECTOR_INDEX_PATH?: string
  OLLAMA_URL?: string
  OLLAMA_MODEL?: string
  OLLAMA_EMBED_MODEL?: string
  AI_PROVIDER?: string
  AI_EMBED_PROVIDER?: string
  AI_BASE_URL?: string
  AI_API_KEY?: string
  AI_MODEL?: string
  AI_EMBED_MODEL?: string
  ENABLE_VECTOR_SEARCH?: string
  DEBUG?: string
  HYDE_MODE?: string
  HYDE_THRESHOLD_SCORE?: string
  HYDE_THRESHOLD_COUNT?: string
  EXPORT_STRATEGIES?: string
  AUTH_STORAGE_PATH?: string
}

/**
 * Creates a validated Config from environment variables.
 * Pass `envOverrides` to inject test values instead of reading process.env.
 */
export function createConfig(envOverrides?: EnvOverrides): Result<Config, Error> {
  loadEnv()

  const env = envOverrides ?? process.env

  const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
  const DEFAULT_RATE_LIMIT_MS = '500'
  const DEFAULT_PARALLEL_WORKERS = '5'
  const DEFAULT_EXTRACTION_CONCURRENCY = '2'
  const DEFAULT_CHECKPOINT_INTERVAL = '10'

  const rawHeadlessValue = env['HEADLESS'] ?? 'false'
  let headless: boolean | 'new' = false
  if (rawHeadlessValue === 'true') {
    headless = true
  } else if (rawHeadlessValue === 'new') {
    headless = 'new'
  }

  const PROJECT_ROOT = join(__dirname, '..', '..')

  const rawConfig = {
    authStoragePath: env['AUTH_STORAGE_PATH'] ?? join(PROJECT_ROOT, '.storage', 'auth.json'),
    waitMode: env['WAIT_MODE'] ?? 'dynamic',
    rateLimitMs: parseInt(env['RATE_LIMIT_MS'] ?? DEFAULT_RATE_LIMIT_MS, 10),
    parallelWorkers: parseInt(env['PARALLEL_WORKERS'] ?? DEFAULT_PARALLEL_WORKERS, 10),
    extractionConcurrency: parseInt(
      env['EXTRACTION_CONCURRENCY'] ?? DEFAULT_EXTRACTION_CONCURRENCY,
      10
    ),
    checkpointSaveInterval: parseInt(
      env['CHECKPOINT_SAVE_INTERVAL'] ?? DEFAULT_CHECKPOINT_INTERVAL,
      10
    ),
    exportDir: env['EXPORT_DIR'] ?? join(PROJECT_ROOT, 'exports'),
    checkpointPath: env['CHECKPOINT_PATH'] ?? join(PROJECT_ROOT, '.storage', 'checkpoint.json'),
    vectorIndexPath: env['VECTOR_INDEX_PATH'] ?? join(PROJECT_ROOT, '.storage', 'vector-index'),
    ollamaUrl: env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL,
    ollamaModel: env['OLLAMA_MODEL'] ?? 'llama3.1',
    ollamaEmbedModel: env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text',
    aiProvider: env['AI_PROVIDER'] ?? 'ollama',
    aiEmbedProvider: env['AI_EMBED_PROVIDER'] ?? env['AI_PROVIDER'] ?? 'ollama',
    aiBaseUrl: env['AI_BASE_URL'],
    aiApiKey: env['AI_API_KEY'],
    aiModel: env['AI_MODEL'] ?? 'llama3.1',
    aiEmbedModel: env['AI_EMBED_MODEL'] ?? 'nomic-embed-text',
    enableVectorSearch: env['ENABLE_VECTOR_SEARCH'],
    headless: headless,
    debug: env['DEBUG'] === 'true',
    hydeMode: env['HYDE_MODE'],
    hydeThresholdScore: parseFloat(env['HYDE_THRESHOLD_SCORE'] || '0.7'),
    hydeThresholdCount: parseInt(env['HYDE_THRESHOLD_COUNT'] || '5', 10),
    exportStrategies: env['EXPORT_STRATEGIES'],
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    const validationError = new Error('Invalid configuration detected')
    for (const issue of result.error.issues) {
      const fieldPath = issue.path.join('.')
      const envVarName = camelToSnakeCase(fieldPath).toUpperCase()
      ;(validationError as { context?: Record<string, unknown> }).context = {
        ...(validationError as { context?: Record<string, unknown> }).context,
        [envVarName]: issue.message,
      }
      logger.error(`  ${envVarName}: ${issue.message}`)
    }
    logger.error('\nPlease check your .env file and fix the above errors.')
    return err(validationError)
  }

  return ok(result.data)
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

/**
 * Initializes directories for the given config.
 * Call this after createConfig().ok to ensure storage dirs exist.
 */
export function initializeConfigDirs(cfg: Config): void {
  ensureDirectoryExistsForFile(cfg.authStoragePath)
  ensureDirectoryExistsForFile(cfg.checkpointPath)
  ensureDirectoryExistsForFile(cfg.vectorIndexPath)
  if (!existsSync(cfg.exportDir)) {
    mkdirSync(cfg.exportDir, { recursive: true })
  }
}

/**
 * Lazy config getter for backward compatibility.
 * Reads process.env on first call and caches the result.
 * Prefer createConfig() with explicit env for new code / tests.
 */
let _cachedConfig: Result<Config, Error> | null = null

export function getConfig(): Result<Config, Error> {
  if (!_cachedConfig) {
    _cachedConfig = createConfig()
    if (_cachedConfig.ok) {
      initializeConfigDirs(_cachedConfig.value)
    }
  }
  return _cachedConfig
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  _cachedConfig = null
}
