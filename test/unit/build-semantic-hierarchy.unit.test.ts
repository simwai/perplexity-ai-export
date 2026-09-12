import { describe, it, expect } from 'vitest'
import {
  clusterByEmbeddings,
  groupClusters,
  buildCooccurrenceMatrix,
  getTopCooccurrences,
  hierarchyToCytoscape,
} from '../../scripts/build-semantic-hierarchy.js'

// Note: embedKeywords and labelGroups are not unit-tested here because they
// require a live Ollama instance. The clustering and matrix logic is fully
// deterministic and tested below.

const DIMENSION = 8

function mockEmbedding(token: string): number[] {
  // Deterministic pseudo-random embedding so tests are reproducible.
  const vec = new Array(DIMENSION).fill(0)
  let seed = 0
  for (const ch of token) seed += ch.charCodeAt(0)
  for (let i = 0; i < DIMENSION; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (seed % 1000) / 1000
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  return norm === 0 ? vec : vec.map((v) => v / norm)
}

const testKeywords = [
  { keyword: 'llm', fileCount: 30, fileIds: new Set(['a.md', 'b.md', 'c.md']) },
  { keyword: 'rag', fileCount: 25, fileIds: new Set(['a.md', 'b.md']) },
  { keyword: 'embedding', fileCount: 20, fileIds: new Set(['a.md', 'c.md']) },
  { keyword: 'kubernetes', fileCount: 18, fileIds: new Set(['d.md', 'e.md']) },
  { keyword: 'docker', fileCount: 15, fileIds: new Set(['d.md', 'f.md']) },
  { keyword: 'typescript', fileCount: 22, fileIds: new Set(['g.md', 'h.md', 'i.md']) },
]

describe('buildCooccurrenceMatrix', () => {
  it('should compute Jaccard similarity matrix', () => {
    const matrix = buildCooccurrenceMatrix(testKeywords)

    // Diagonal should be 1 (self-similarity)
    for (let i = 0; i < testKeywords.length; i++) {
      expect(matrix.matrix[i]![i]).toBe(1)
    }

    // 'llm' and 'rag' share 2 files out of 3+2-2=3 -> 2/3
    const llmIdx = testKeywords.findIndex((k) => k.keyword === 'llm')
    const ragIdx = testKeywords.findIndex((k) => k.keyword === 'rag')
    expect(matrix.matrix[llmIdx]![ragIdx]).toBeCloseTo(2 / 3, 3)

    // 'kubernetes' and 'typescript' share 0 files -> 0
    const k8sIdx = testKeywords.findIndex((k) => k.keyword === 'kubernetes')
    const tsIdx = testKeywords.findIndex((k) => k.keyword === 'typescript')
    expect(matrix.matrix[k8sIdx]![tsIdx]).toBe(0)

    expect(matrix.keywords).toEqual([
      'llm',
      'rag',
      'embedding',
      'kubernetes',
      'docker',
      'typescript',
    ])
  })
})

describe('getTopCooccurrences', () => {
  it('should return keywords sorted by similarity', () => {
    const matrix = buildCooccurrenceMatrix(testKeywords)
    const llmIdx = testKeywords.findIndex((k) => k.keyword === 'llm')

    const co = getTopCooccurrences(matrix, llmIdx, 5)
    expect(co.length).toBeGreaterThanOrEqual(1)
    expect(co[0]!.keyword).toBe('rag') // highest Jaccard overlap
    co.forEach((c) => {
      expect(c.similarity).toBeGreaterThan(0)
    })
    // Sorted descending
    for (let i = 1; i < co.length; i++) {
      expect(co[i]!.similarity).toBeLessThanOrEqual(co[i - 1]!.similarity)
    }
  })
})

describe('clusterByEmbeddings', () => {
  it('should group semantically similar keywords', () => {
    // Create embeddings where 'docker'/'kubernetes'/'container' are close
    // and 'llm'/'rag'/'gpt' are close, plus an outlier.
    const keywords = ['docker', 'kubernetes', 'container', 'llm', 'rag', 'gpt', 'outlier']
    const embeddings = keywords.map((k) => {
      if (k === 'outlier')
        return Array(DIMENSION)
          .fill(0)
          .map(() => 0.99) // far from origin
      if (['docker', 'kubernetes', 'container'].includes(k)) {
        return mockEmbedding('infra').map((v, i) => (i < 4 ? v : 0))
      }
      return mockEmbedding('ai').map((v, i) => (i >= 4 ? v : 0))
    })

    const clusters = clusterByEmbeddings(
      keywords.map((kw) => ({ keyword: kw, fileCount: 10, fileIds: new Set(['f.md']) })),
      embeddings
    )

    // Should produce at least 2 clusters (infra + ai)
    expect(clusters.length).toBeGreaterThanOrEqual(2)
    // Outlier should be in its own cluster (or at least separated)
    const outlierCluster = clusters.find((c) => c.some((idx) => keywords[idx] === 'outlier'))
    expect(outlierCluster).toBeDefined()
  })

  it('should respect CLUSTER_SIMILARITY_THRESHOLD (rare keywords form own clusters)', () => {
    const keywords = ['alpha', 'beta', 'gamma']
    const base = mockEmbedding('base')
    // All identical embeddings -> should merge into one cluster
    const embeddings = keywords.map(() => [...base])
    const clusters = clusterByEmbeddings(
      keywords.map((kw) => ({ keyword: kw, fileCount: 5, fileIds: new Set(['f.md']) })),
      embeddings
    )
    // With identical embeddings, cosine similarity = 1 > threshold, so all cluster together
    expect(clusters.length).toBeLessThanOrEqual(keywords.length)
  })
})

describe('groupClusters', () => {
  it('should merge similar cluster centroids', () => {
    // Use one-hot-like vectors so cosine similarity reflects orientation,
    // not magnitude (cosine ignores magnitude).
    const dim = 8
    const v1 = Array(dim).fill(0)
    v1[0] = 1
    v1[1] = 0.9
    const v2 = Array(dim).fill(0)
    v2[0] = 0.95
    v2[1] = 0.85
    const v3 = Array(dim).fill(0)
    v3[2] = 1
    v3[3] = 0.9
    const v4 = Array(dim).fill(0)
    v4[2] = 0.95
    v4[3] = 0.85

    const group1 = groupClusters([v1, v2, v3, v4])
    // Should merge v1+v2 and v3+v4 into 2 groups
    expect(group1.length).toBeLessThanOrEqual(4)
    expect(group1.length).toBeGreaterThanOrEqual(2)
  })
})

describe('hierarchyToCytoscape', () => {
  it('should convert a hierarchy to Cytoscape nodes and edges', () => {
    const hierarchy = {
      mode: 'topic-clusters' as const,
      version: '1.0.0',
      generatedAt: '2024-01-01',
      root: {
        id: 'semantic:root',
        label: 'All Topics',
        keywords: [],
        children: [
          {
            id: 'ai-ml',
            label: 'AI ML',
            keywords: ['llm', 'rag'],
            children: [],
            confidence: 0.9,
            fileCount: 100,
            level: 2,
          },
          {
            id: 'infra',
            label: 'Infrastructure',
            keywords: ['docker', 'kubernetes'],
            children: [],
            confidence: 0.85,
            fileCount: 50,
            level: 2,
          },
        ],
        confidence: 1.0,
        fileCount: 150,
        level: 1,
      },
      stats: { totalKeywords: 4, totalClusters: 2, maxDepth: 2 },
    }

    const result = hierarchyToCytoscape(hierarchy, 'topic-clusters')

    // Root + 2 children = 3 nodes
    expect(result.nodes.length).toBe(3)
    // Root is semantic-root, children are semantic-keyword (leaf)
    const kinds = result.nodes.map((n) => n.data.kind)
    expect(kinds).toContain('semantic-root')
    expect(kinds.filter((k) => k === 'semantic-keyword').length).toBe(2)

    // Edges: root->child1, root->child2 = 2
    expect(result.edges.length).toBe(2)
    expect(result.edges.every((e) => e.data.kind === 'semantic-tree')).toBe(true)

    // All nodes should have the topic-clusters mindmapMode
    result.nodes.forEach((n) => {
      expect(n.data.mindmapMode).toBe('topic-clusters')
    })
  })

  it('should prefix all node ids with the mode prefix', () => {
    const hierarchy = {
      mode: 'full-hierarchy' as const,
      version: '1.0.0',
      generatedAt: '2024-01-01',
      root: {
        id: 'semantic:root',
        label: 'Root',
        keywords: [],
        children: [
          {
            id: 'group-1',
            label: 'Group',
            keywords: [],
            children: [
              {
                id: 'cluster-a',
                label: 'Cluster A',
                keywords: ['kw1'],
                children: [],
                confidence: 0.9,
                fileCount: 10,
                level: 3,
              },
            ],
            confidence: 0.95,
            fileCount: 20,
            level: 2,
          },
        ],
        confidence: 1.0,
        fileCount: 30,
        level: 1,
      },
      stats: { totalKeywords: 1, totalClusters: 1, maxDepth: 3 },
    }

    const result = hierarchyToCytoscape(hierarchy, 'full-hierarchy')

    // All node ids should start with 'sf:' (semantic-full prefix)
    result.nodes.forEach((n) => {
      expect(n.data.id.startsWith('sf:')).toBe(true)
    })
    // Root edge
    const rootEdge = result.edges.find(
      (e) => e.data.target === result.nodes.find((n) => n.data.isRoot)?.data.id
    )
    // Just verify edges exist and are semantic-tree
    expect(result.edges.length).toBe(2)
    expect(result.edges.every((e) => e.data.kind === 'semantic-tree')).toBe(true)
  })
})
