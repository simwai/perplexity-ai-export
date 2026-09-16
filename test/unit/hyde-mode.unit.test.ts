import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { RipgrepSearch } from '../../src/search/rg-search.js'
import { ok } from 'super-result'
import { createHydeMockConfig } from '../helpers/test-config.js'
import {
  createMockVectorStore,
  createMockOllamaClient,
  createMockRipgrepSearch,
} from '../helpers/mock-factories.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('RagOrchestrator HyDE Modes', () => {
  let config: ReturnType<typeof import('../helpers/test-config.js').createHydeMockConfig>
  let orchestrator: ReturnType<
    typeof import('../helpers/mock-factories.js').createMockRagOrchestrator
  >
  let mockVectorStore: ReturnType<
    typeof import('../helpers/mock-factories.js').createMockVectorStore
  >
  let mockOllamaClient: ReturnType<
    typeof import('../helpers/mock-factories.js').createMockOllamaClient
  >
  let mockRipgrepSearch: ReturnType<
    typeof import('../helpers/mock-factories.js').createMockRipgrepSearch
  >

  beforeEach(() => {
    config = createHydeMockConfig()
    mockVectorStore = createMockVectorStore()
    mockOllamaClient = createMockOllamaClient()

    orchestrator = new RagOrchestrator(config)
    orchestrator.vectorStore = mockVectorStore
    orchestrator.ripgrep = new RipgrepSearch(config)

    // RagOrchestrator uses this.aiClient (AiClient), not this.ollamaClient
    ;(orchestrator as unknown as { aiClient: any }).aiClient = {
      generate: mockOllamaClient.generate,
      chat: mockOllamaClient.chat,
      embed: mockOllamaClient.embed,
      validate: mockOllamaClient.validate,
    }

    mockOllamaClient.generate.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        strategy: 'precise',
        queries: ['query1'],
        hardKeywords: [],
        hydePassage: 'hypothetical passage',
      }),
    })
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

    expect(mockVectorStore.search).toHaveBeenCalledTimes(2)
    expect(mockVectorStore.search).toHaveBeenCalledWith('hypothetical passage', 40)
  })

  it('should trigger HyDE in supplement mode when results are weak', async () => {
    config.hydeMode = 'supplement'
    mockVectorStore.search
      .mockResolvedValueOnce({ ok: true, value: [{ meta: { id: '1' }, score: 0.5 }] })
      .mockResolvedValueOnce({ ok: true, value: [] })

    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(2)
  })

  it('should NOT trigger HyDE in supplement mode when results are strong', async () => {
    config.hydeMode = 'supplement'
    mockVectorStore.search.mockResolvedValueOnce({
      ok: true,
      value: [
        { meta: { id: '1' }, score: 0.9 },
        { meta: { id: '2' }, score: 0.8 },
        { meta: { id: '3' }, score: 0.8 },
        { meta: { id: '4' }, score: 0.8 },
        { meta: { id: '5' }, score: 0.8 },
        { meta: { id: '6' }, score: 0.8 },
      ],
    })

    const plan = await orchestrator.developResearchPlan('test question')
    await orchestrator.executeAdaptiveHybridSearch(plan)

    expect(mockVectorStore.search).toHaveBeenCalledTimes(1)
  })
})
