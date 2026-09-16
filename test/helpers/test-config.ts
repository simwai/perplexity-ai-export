/**
 * Shared test helpers for mock configs and common test utilities.
 * Reduces duplication and brittleness across test files.
 */

import type { Config } from '../../src/utils/config.js'

/**
 * Creates a minimal valid mock Config for unit tests.
 * Override only the fields needed by the specific test.
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    authStoragePath: '/tmp/auth.json',
    checkpointPath: '/tmp/checkpoint.json',
    waitMode: 'dynamic',
    rateLimitMs: 500,
    parallelWorkers: 5,
    extractionConcurrency: 2,
    checkpointSaveInterval: 10,
    exportDir: '/tmp/exports',
    vectorIndexPath: '/tmp/vector-index',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    aiBaseUrl: undefined,
    aiApiKey: undefined,
    aiModel: undefined,
    aiEmbedModel: undefined,
    enableVectorSearch: undefined,
    headless: false,
    debug: false,
    hydeMode: 'supplement',
    hydeThresholdScore: 0.7,
    hydeThresholdCount: 5,
    exportStrategies: ['markdown'],
    ...overrides,
  }
}

/**
 * Creates a mock config for Ollama-related tests.
 */
export function createOllamaMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    debug: false,
    ...overrides,
  })
}

/**
 * Creates a mock config for scraper tests.
 */
export function createScraperMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    authStoragePath: '/tmp/auth.json',
    checkpointPath: '/tmp/checkpoint.json',
    waitMode: 'dynamic',
    rateLimitMs: 500,
    parallelWorkers: 1,
    extractionConcurrency: 1,
    checkpointSaveInterval: 10,
    exportDir: '/tmp/exports',
    vectorIndexPath: '/tmp/vector-index',
    debug: true,
    ...overrides,
  })
}

/**
 * Creates a mock config for AI client tests.
 */
export function createAiMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    aiBaseUrl: 'http://localhost:11434/v1',
    aiModel: 'llama3.1',
    aiEmbedModel: 'nomic-embed-text',
    debug: false,
    ...overrides,
  })
}

/**
 * Creates a mock config for HyDE mode tests.
 */
export function createHydeMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    hydeMode: 'supplement',
    hydeThresholdScore: 0.7,
    hydeThresholdCount: 5,
    ollamaModel: 'test-model',
    exportDir: 'exports',
    debug: false,
    ...overrides,
  })
}

/**
 * Creates a mock config for vector store tests.
 */
export function createVectorStoreMockConfig(overrides: Partial<Config> = {}): Config {
  const testExports = '/tmp/test-exports'
  const testIndex = '/tmp/test-vector-index'
  return createMockConfig({
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    exportDir: testExports,
    vectorIndexPath: testIndex,
    debug: false,
    authStoragePath: '/tmp/auth.json',
    checkpointPath: '/tmp/checkpoint.json',
    waitMode: 'dynamic',
    rateLimitMs: 500,
    parallelWorkers: 5,
    extractionConcurrency: 2,
    checkpointSaveInterval: 10,
    ...overrides,
  })
}

/**
 * Creates a mock config for conversation extractor tests.
 */
export function createConversationExtractorMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    waitMode: 'static',
    rateLimitMs: 1000,
    debug: true,
    authStoragePath: '/tmp/auth.json',
    parallelWorkers: 1,
    checkpointSaveInterval: 10,
    exportDir: '/tmp/exports',
    checkpointPath: '/tmp/checkpoint.json',
    vectorIndexPath: '/tmp/vector-index',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    aiBaseUrl: undefined,
    aiApiKey: undefined,
    aiModel: 'llama3.1',
    aiEmbedModel: 'nomic-embed-text',
    enableVectorSearch: false,
    headless: false,
    hydeMode: 'supplement',
    hydeThresholdScore: 0.7,
    hydeThresholdCount: 5,
    exportStrategies: ['markdown'],
    extractionConcurrency: 1,
    ...overrides,
  })
}

/**
 * Creates a minimal mock config for OllamaClient tests.
 */
export function createOllamaClientMockConfig(overrides: Partial<Config> = {}): Config {
  return createMockConfig({
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    ollamaEmbedModel: 'nomic-embed-text',
    aiProvider: 'ollama',
    aiEmbedProvider: 'ollama',
    debug: false,
    ...overrides,
  })
}
