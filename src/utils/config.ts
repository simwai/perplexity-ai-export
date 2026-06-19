import { config as loadEnvironmentVariables } from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { errorBus } from './error-bus.js'

loadEnvironmentVariables()

const applicationConfigurationSchema = z.object({
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
  enableVectorSearch: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  headless: z.preprocess(
    (value) => {
      if (value === 'true') return true
      if (value === 'false') return false
      return value
    },
    z.union([z.boolean(), z.literal('new')])
  ),
  debug: z.preprocess((value) => value === 'true', z.boolean()),
})

export type Config = z.infer<typeof applicationConfigurationSchema>

function parseConfigurationFromEnvironment(): Config {
  const rawEnvironmentValues = {
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

  const validationResult = applicationConfigurationSchema.safeParse(rawEnvironmentValues)

  if (!validationResult.success) {
    validationResult.error.issues.forEach((validationIssue) => {
      const configurationFieldPath = validationIssue.path.join('.')
      const environmentVariableName = configurationFieldPath
        .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        .toUpperCase()
      errorBus.emitError(
        `Configuration error: ${environmentVariableName} - ${validationIssue.message}`
      )
    })
    process.exit(1)
  }

  return validationResult.data
}

export const config: Config = parseConfigurationFromEnvironment()

function ensureDirectoryExistsForPath(targetPath: string) {
  const directoryPath = dirname(targetPath)
  try {
    if (!existsSync(directoryPath)) {
      mkdirSync(directoryPath, { recursive: true })
    }
  } catch (filesystemError) {
    errorBus.emitError(`Failed to create directory for path: ${targetPath}`, filesystemError)
  }
}

ensureDirectoryExistsForPath(config.authStoragePath)
ensureDirectoryExistsForPath(config.checkpointPath)
ensureDirectoryExistsForPath(config.vectorIndexPath)

try {
  if (!existsSync(config.exportDir)) {
    mkdirSync(config.exportDir, { recursive: true })
  }
} catch (exportDirectoryError) {
  errorBus.emitError(`Failed to create export directory`, exportDirectoryError)
}
