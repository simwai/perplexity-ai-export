import { performance } from 'node:perf_hooks'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './utils/config.js'
import { errorBus } from './utils/error-bus.js'
import { logger } from './utils/logger.js'
import { VectorStore } from './search/vector-store.js'
import { RagOrchestrator } from './ai/rag-orchestrator.js'

const BENCHMARK_QUERIES = [
  'What TypeScript patterns have I used in past projects?',
  'Which npm packages have I discussed installing?',
  'What errors or bugs did I troubleshoot recently?',
  'What AI models or tools have I researched?',
  'What architecture decisions did I make?',
]

async function runBenchmark(): Promise<void> {
  const indexJsonPath = join(config.vectorIndexPath, 'index.json')
  const isIndexPresent = existsSync(indexJsonPath)
  if (!isIndexPresent) {
    logger.error('No vector index found. Build the index first via the main menu.')
    process.exit(1)
  }

  logger.info(`Starting benchmark with ${BENCHMARK_QUERIES.length} queries...`)

  const benchmarkVectorStore = new VectorStore(config)
  await benchmarkVectorStore.validate()

  const ragOrchestrator = new RagOrchestrator(config)
  const benchmarkResults: { query: string; durationMs: number; isFailure: boolean }[] = []

  for (let queryIndex = 0; queryIndex < BENCHMARK_QUERIES.length; queryIndex++) {
    const currentQuery = BENCHMARK_QUERIES[queryIndex]!
    logger.info(`[${queryIndex + 1}/${BENCHMARK_QUERIES.length}] "${currentQuery}"`)

    const startTime = performance.now()
    let isFailure = false

    try {
      await ragOrchestrator.answerQuestion(currentQuery)
    } catch (error) {
      isFailure = true
      errorBus.emitError('Benchmark query failed', error, { query: currentQuery })
    }

    const durationMs = Math.round(performance.now() - startTime)
    benchmarkResults.push({ query: currentQuery, durationMs, isFailure })

    if (isFailure) {
      logger.warn(`Query failed after ${durationMs}ms`)
    } else {
      logger.success(`Done in ${durationMs}ms`)
    }
  }

  const successfulResults = benchmarkResults.filter((result) => !result.isFailure)
  const failedResults = benchmarkResults.filter((result) => result.isFailure)

  const totalSuccessfulDuration = successfulResults.reduce(
    (accumulator, result) => accumulator + result.durationMs,
    0
  )
  const averageLatencyMs =
    successfulResults.length > 0
      ? Math.round(totalSuccessfulDuration / successfulResults.length)
      : 0

  logger.info('--- Benchmark Results ---')
  benchmarkResults.forEach((result, index) => {
    const statusSymbol = result.isFailure ? '✗' : '✓'
    logger.info(`  ${statusSymbol} [${index + 1}] ${result.durationMs}ms — ${result.query}`)
  })

  logger.info(`Successful: ${successfulResults.length}/${benchmarkResults.length}`)
  logger.info(`Average latency: ${averageLatencyMs}ms`)

  const hasFailures = failedResults.length > 0
  if (hasFailures) {
    logger.warn(`${failedResults.length} queries failed — run with DEBUG=true for details`)
  }
}

runBenchmark().catch((error) => {
  errorBus.emitError('Benchmark execution failed', error)
  process.exit(1)
})
