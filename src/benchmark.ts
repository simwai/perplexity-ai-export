import { performance } from 'node:perf_hooks'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config as applicationConfiguration } from './utils/config.js'
import { errorBus } from './utils/error-bus.js'
import { logger } from './utils/logger.js'
import { VectorStore } from './search/vector-store.js'
import { RagOrchestrator } from './ai/rag-orchestrator.js'

const TEST_BENCHMARK_QUERIES = [
  'What TypeScript patterns have I used in past projects?',
  'Which npm packages have I discussed installing?',
  'What errors or bugs did I troubleshoot recently?',
  'What AI models or tools have I researched?',
  'What architecture decisions did I make?',
]

async function runPerformanceBenchmark(): Promise<void> {
  const vectorIndexMetadataFilePath = join(applicationConfiguration.vectorIndexPath, 'index.json')

  if (!existsSync(vectorIndexMetadataFilePath)) {
    errorBus.raiseError('No vector index found. Build the index first via the main menu.')
  }

  logger.info(`Starting benchmark with ${TEST_BENCHMARK_QUERIES.length} queries...`)

  const benchmarkVectorStore = new VectorStore(applicationConfiguration)
  await benchmarkVectorStore.validate()

  const benchmarkRagOrchestrator = new RagOrchestrator(applicationConfiguration)
  const benchmarkRunResults: {
    queryText: string
    durationMilliseconds: number
    isFailure: boolean
  }[] = []

  for (let queryIndex = 0; queryIndex < TEST_BENCHMARK_QUERIES.length; queryIndex++) {
    const currentBenchmarkQuery = TEST_BENCHMARK_QUERIES[queryIndex]!
    logger.info(`[${queryIndex + 1}/${TEST_BENCHMARK_QUERIES.length}] "${currentBenchmarkQuery}"`)

    const startTimeStamp = performance.now()
    let isQuerySuccessful = true

    try {
      await benchmarkRagOrchestrator.answerQuestion(currentBenchmarkQuery)
    } catch (queryExecutionError) {
      isQuerySuccessful = false
      errorBus.emitError('Benchmark query failed', queryExecutionError, {
        query: currentBenchmarkQuery,
      })
    }

    const durationMilliseconds = Math.round(performance.now() - startTimeStamp)
    benchmarkRunResults.push({
      queryText: currentBenchmarkQuery,
      durationMilliseconds,
      isFailure: !isQuerySuccessful,
    })

    if (!isQuerySuccessful) {
      logger.warn(`Query failed after ${durationMilliseconds}ms`)
    } else {
      logger.success(`Done in ${durationMilliseconds}ms`)
    }
  }

  const successfulBenchmarkRuns = benchmarkRunResults.filter((result) => !result.isFailure)

  const totalSuccessfulDurationMilliseconds = successfulBenchmarkRuns.reduce(
    (cumulativeDuration, runResult) => cumulativeDuration + runResult.durationMilliseconds,
    0
  )

  const averageLatencyMilliseconds =
    successfulBenchmarkRuns.length > 0
      ? Math.round(totalSuccessfulDurationMilliseconds / successfulBenchmarkRuns.length)
      : 0

  logger.info('--- Benchmark Results ---')
  benchmarkRunResults.forEach((runResult, index) => {
    const statusSuccessSymbol = runResult.isFailure ? '✗' : '✓'
    logger.info(
      `  ${statusSuccessSymbol} [${index + 1}] ${runResult.durationMilliseconds}ms — ${runResult.queryText}`
    )
  })

  logger.info(`Successful: ${successfulBenchmarkRuns.length}/${benchmarkRunResults.length}`)
  logger.info(`Average latency: ${averageLatencyMilliseconds}ms`)

  const hasAnyFailuresOccurred = benchmarkRunResults.some((result) => result.isFailure)
  if (hasAnyFailuresOccurred) {
    logger.warn(`Some queries failed — run with DEBUG=true for details`)
  }
}

runPerformanceBenchmark().catch((executionError) => {
  errorBus.emitError('Benchmark execution failed', executionError)
  process.exit(1)
})
