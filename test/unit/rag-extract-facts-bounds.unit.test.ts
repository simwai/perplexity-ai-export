import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/search/vector-store.js', () => {
  return {
    VectorStore: class {
      validate = vi.fn().mockResolvedValue(undefined)
      search = vi.fn().mockResolvedValue([])
    },
    __esModule: true,
  }
})

vi.mock('../../src/search/rg-search.js', () => {
  return {
    RgSearch: class {
      captureSearchMatches = vi.fn().mockResolvedValue([])
    },
    __esModule: true,
  }
})

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/ai/ollama-client.js', () => {
  return {
    OllamaClient: class {
      generate = vi.fn()
      chat = vi.fn()
    },
    __esModule: true,
  }
})

import { RagOrchestrator } from '../../src/ai/rag-orchestrator.js'
import { OllamaClient } from '../../src/ai/ollama-client.js'
import { VectorStore } from '../../src/search/vector-store.js'
import { config } from '../../src/utils/config.js'
import { ok, err } from 'super-result'

interface MockedOrchestrator {
  rag: RagOrchestrator
  ollamaGenerate: ReturnType<typeof vi.fn>
  vectorSearch: ReturnType<typeof vi.fn>
}

function setup(): MockedOrchestrator {
  const rag = new RagOrchestrator(config)
  const ollamaGenerate = vi.mocked(new OllamaClient(config).generate)
  ollamaGenerate.mockReset()
  const vectorSearch = vi.mocked(new VectorStore(config).search)
  vectorSearch.mockReset()
  ;(rag as unknown as { ollamaClient: OllamaClient }).ollamaClient = {
    generate: ollamaGenerate,
    chat: vi.fn(),
  } as unknown as OllamaClient
  ;(rag as unknown as { vectorStore: VectorStore }).vectorStore = {
    validate: vi.fn().mockResolvedValue(undefined),
    search: vectorSearch,
  } as unknown as VectorStore
  ;(rag as unknown as { ripgrep: unknown }).ripgrep = {
    captureSearchMatches: vi.fn().mockResolvedValue([]),
  }
  return { rag, ollamaGenerate, vectorSearch }
}

describe('RagOrchestrator.extractFactsWithGranularMapReduce bounds (Unit)', () => {
  let setupData: MockedOrchestrator

  beforeEach(() => {
    setupData = setup()
  })

  it('skips out-of-range node_id values without misattributing provenance', async () => {
    const fakeSnippets1 = [
      { meta: { title: 'Thread A', snippet: 'snippet A', id: 'a' }, score: 0.9 },
      { meta: { title: 'Thread B', snippet: 'snippet B', id: 'b' }, score: 0.8 },
      { meta: { title: 'Thread C', snippet: 'snippet C', id: 'c' }, score: 0.7 },
    ]
    setupData.vectorSearch.mockResolvedValue(fakeSnippets1)

    const extractMethod = (
      setupData.rag as unknown as {
        extractFactsWithGranularMapReduce: (
          q: string,
          r: typeof fakeSnippets1,
          exhaustive: boolean
        ) => Promise<Array<{ fact: string; source_title: string; thread: string }>>
      }
    ).extractFactsWithGranularMapReduce.bind(setupData.rag)

    // Return Result objects with ok()
    setupData.ollamaGenerate.mockResolvedValueOnce(
      ok(
        JSON.stringify([
          { fact: 'good from A', node_id: 0, thread: 'Thread A' },
          { fact: 'out of range', node_id: 99, thread: 'Thread Z' },
          { fact: 'negative index', node_id: -1, thread: 'Thread W' },
          { fact: 'not an integer', node_id: 1.5, thread: 'Thread V' },
          { fact: 'missing node_id', fact_only: true, thread: 'Thread U' },
          { fact: 'good from B', node_id: 1, thread: 'Thread B' },
        ])
      )
    )

    const fakeSnippets2 = [
      { meta: { title: 'Thread A', snippet: 'snippet A', id: 'a' }, score: 0.9 },
      { meta: { title: 'Thread B', snippet: 'snippet B', id: 'b' }, score: 0.8 },
      { meta: { title: 'Thread C', snippet: 'snippet C', id: 'c' }, score: 0.7 },
    ]

    const extractMethod2 = (
      setupData.rag as unknown as {
        extractFactsWithGranularMapReduce: (
          q: string,
          r: typeof fakeSnippets2,
          exhaustive: boolean
        ) => Promise<Array<{ fact: string; source_title: string; thread: string }>>
      }
    ).extractFactsWithGranularMapReduce.bind(setupData.rag)

    const facts = await extractMethod('test', fakeSnippets2, false)

    expect(facts).toHaveLength(2)
    expect(facts[0]?.source_title).toBe('Thread A')
    expect(facts[0]?.fact).toBe('good from A')
    expect(facts[1]?.source_title).toBe('Thread B')
    expect(facts[1]?.fact).toBe('good from B')
  })

  it('falls back to raw snippet when LLM returns no JSON array', async () => {
    const fakeSnippets3 = [
      { meta: { title: 'Only Thread', snippet: 'only snippet', id: 'x' }, score: 0.9 },
    ]
    setupData.vectorSearch.mockResolvedValue(fakeSnippets3)

    const extractMethod3 = (
      setupData.rag as unknown as {
        extractFactsWithGranularMapReduce: (
          q: string,
          r: typeof fakeSnippets3,
          exhaustive: boolean
        ) => Promise<Array<{ fact: string; source_title: string; thread: string }>>
      }
    ).extractFactsWithGranularMapReduce.bind(setupData.rag)

    setupData.ollamaGenerate.mockResolvedValueOnce(ok('not a json response at all'))

    const facts = await extractMethod3('test', fakeSnippets3, false)

    expect(facts).toHaveLength(1)
    expect(facts[0]?.fact).toBe('only snippet')
    expect(facts[0]?.source_title).toBe('Only Thread')
  })
})
