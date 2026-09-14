import { performance } from 'node:perf_hooks'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './utils/config.js'
import { errorBus } from './utils/error-bus.js'
import { logger } from './utils/logger.js'
import { VectorStore } from './search/vector-store.js'
import { RagOrchestrator } from './ai/rag-orchestrator.js'
import { from, ok, err, type Result } from 'super-result'

const BENCHMARK_QUERIES = [
  'What TypeScript patterns have I used in past projects?',
  'Which npm packages have I discussed installing?',
  'What errors or bugs did I troubleshoot recently?',
  'What AI models or tools have I researched?',
  'What architecture decisions did I make?',
]

async function runBenchmark(): Promise<Result<void, Error>> {
  const indexJsonPath = join(config.vectorIndexPath, 'index.json')
  const isIndexPresent = existsSync(indexJsonPath)
  if (!isIndexPresent) {
    return err(new Error('No vector index found. Build the index first via the main menu.'))
  }

  logger.info(`Starting benchmark with ${BENCHMARK_QUERIES.length} queries...`)

  const benchmarkVectorStore = new VectorStore(config)
  await benchmarkVectorStore.validate()

  const ragOrchestrator = new RagOrchestrator(config)
  const benchmarkResults: { query: string; durationMs: number; isFailure: boolean }[] = []

  for (const [queryIndex, currentQuery] of BENCHMARK_QUERIES.entries()) {
    logger.info(`[${queryIndex + 1}/${BENCHMARK_QUERIES.length}] "${currentQuery}"`)

    const startTime = performance.now()
    let isFailure = false

    const answerResult = await ragOrchestrator.answerQuestion(currentQuery)
    if (!answerResult.ok) {
      isFailure = true
      errorBus.emitError('Benchmark query failed', answerResult.error, { query: currentQuery })
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

  let totalSuccessfulDuration = 0
  for (const result of successfulResults) {
    totalSuccessfulDuration += result.durationMs
  }
  const averageLatencyMs =
    successfulResults.length > 0
      ? Math.round(totalSuccessfulDuration / successfulResults.length)
      : 0

  logger.info('--- Benchmark Results ---')
  for (const [index, result] of benchmarkResults.entries()) {
    const statusSymbol = result.isFailure ? '✗' : '✓'
    logger.info(`  ${statusSymbol} [${index + 1}] ${result.durationMs}ms — ${result.query}`)
  }

  logger.info(`Successful: ${successfulResults.length}/${benchmarkResults.length}`)
  logger.info(`Average latency: ${averageLatencyMs}ms`)

  const hasFailures = failedResults.length > 0
  if (hasFailures) {
    logger.warn(`${failedResults.length} queries failed — run with DEBUG=true for details`)
  }

  return ok(undefined)
}

const result = await from(async () => runBenchmark())
if (!result.ok) {
  errorBus.emitError('Benchmark execution failed', result.error)
  throw result.error
}
