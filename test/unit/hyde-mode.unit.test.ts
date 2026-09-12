import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { RipgrepSearch } from '../../src/search/rg-search.js'
import { ok, err } from 'super-result'

vi.mock('../../src/search/vector-store.js')
vi.mock('../../src/ai/ollama-client.js')
vi.mock('../../src/search/rg-search.js')
vi.mock('../../src/utils/logger.js')

describe('RagOrchestrator HyDE Modes', () => {
  let config: any
  let orchestrator: any
  let mockVectorStore: any
  let mockOllamaClient: any

  beforeEach(() => {
    config = {
      hydeMode: 'supplement',
      hydeThresholdScore: 0.7,
      hydeThresholdCount: 5,
      ollamaModel: 'test-model',
      exportDir: 'exports',
    }
    mockVectorStore = new VectorStore(config)
    mockOllamaClient = new OllamaClient(config)

    orchestrator = new RagOrchestrator(config)
    orchestrator.vectorStore = mockVectorStore
    orchestrator.ollamaClient = mockOllamaClient
    orchestrator.ripgrep = new RipgrepSearch(config)

    // Default mocks - return Result objects
    mockOllamaClient.generate.mockResolvedValue(
      ok(
        JSON.stringify({
          strategy: 'precise',
          queries: ['query1'],
          hardKeywords: [],
          hydePassage: 'hypothetical passage',
        })
      )
    )
    mockVectorStore.search.mockResolvedValue(ok([]))
  })

  it('should NOT trigger HyDE when mode is "off"', async () => {
    config.hydeMode = 'off'
    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(1)
    expect(mockVectorStore.search).not.toHaveBeenCalledWith('hypothetical passage', 40)
  })

  it('should ALWAYS trigger HyDE when mode is "fusion"', async () => {
    config.hydeMode = 'fusion'
    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(2) // 1 query + 1 hyde
    expect(mockVectorStore.search).toHaveBeenCalledWith('hypothetical passage', 40)
  })

  it('should trigger HyDE in supplement mode when results are weak', async () => {
    config.hydeMode = 'supplement'
    // First call returns weak results, second call returns HyDE results
    mockVectorStore.search
      .mockResolvedValueOnce(ok([{ meta: { id: '1', score: 0.5 }, score: 0.5 }]))
      .mockResolvedValueOnce(ok([]))

    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(2)
  })

  it('should NOT trigger HyDE in supplement mode when results are strong', async () => {
    config.hydeMode = 'supplement'
    mockVectorStore.search.mockResolvedValueOnce(
      ok([
        { meta: { id: '1' }, score: 0.9 },
        { meta: { id: '2' }, score: 0.8 },
        { meta: { id: '3' }, score: 0.8 },
        { meta: { id: '4' }, score: 0.8 },
        { meta: { id: '5' }, score: 0.8 },
        { meta: { id: '6' }, score: 0.8 },
      ])
    )

    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(1)
  })
})
