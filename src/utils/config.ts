import { config as loadEnv } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { errorBus } from './error-bus.js'

loadEnv()

const configSchema = z.object({
  authStoragePath: z.string().min(1),
  waitMode: z.enum(['dynamic', 'static']),
  rateLimitMs: z.coerce.number().int().positive(),
  parallelWorkers: z.coerce.number().int().min(1).max(20),
  checkpointSaveInterval: z.coerce.number().int().positive(),
  exportDir: z.string().min(1),
  checkpointPath: z.string().min(1),
  vectorIndexPath: z.string().min(1),
  ollamaUrl: z.string().url(),
  ollamaModel: z.string().min(1),
  ollamaEmbedModel: z.string().min(1),
  enableVectorSearch: z.string().optional().transform((val) => val === 'true'),
  headless: z.preprocess((val) => {
    if (val === 'true') return true
    if (val === 'false') return false
    return val
  }, z.union([z.boolean(), z.literal('new')])),
  debug: z.preprocess((val) => val === 'true', z.boolean()),
})

export type Config = z.infer<typeof configSchema>

function parseEnvConfig(): Config {
  const raw = {
    authStoragePath: process.env['AUTH_STORAGE_PATH'] ?? join('.storage', 'auth.json'),
    waitMode: process.env['WAIT_MODE'] ?? 'dynamic',
    rateLimitMs: process.env['RATE_LIMIT_MS'] ?? '500',
    parallelWorkers: process.env['PARALLEL_WORKERS'] ?? '5',
    checkpointSaveInterval: process.env['CHECKPOINT_SAVE_INTERVAL'] ?? '10',
    exportDir: process.env['EXPORT_DIR'] ?? 'exports',
    checkpointPath: process.env['CHECKPOINT_PATH'] ?? join('.storage', 'checkpoint.json'),
    vectorIndexPath: process.env['VECTOR_INDEX_PATH'] ?? join('.storage', 'vector-index'),
    ollamaUrl: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
    ollamaModel: process.env['OLLAMA_MODEL'] ?? 'llama3.1',
    ollamaEmbedModel: process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text',
    enableVectorSearch: process.env['ENABLE_VECTOR_SEARCH'],
    headless: process.env['HEADLESS'] ?? 'false',
    debug: process.env['DEBUG'] ?? 'false',
  }

  const result = configSchema.safeParse(raw)
  if (!result.success) {
    result.error.issues.forEach((i) => {
      const field = i.path.join('.')
      const env = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`).toUpperCase()
      errorBus.emitError(`Config error: ${env} - ${i.message}`)
    })
    process.exit(1)
  }
  return result.data
}

export const config: Config = parseEnvConfig()

function ensureDir(p: string) {
  const d = dirname(p)
  try {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  } catch (e) {
    errorBus.emitError(`Failed to create directory for ${p}`, e)
  }
}

ensureDir(config.authStoragePath)
ensureDir(config.checkpointPath)
ensureDir(config.vectorIndexPath)
try {
  if (!existsSync(config.exportDir)) mkdirSync(config.exportDir, { recursive: true })
} catch (e) {
  errorBus.emitError(`Failed to create export directory`, e)
}
