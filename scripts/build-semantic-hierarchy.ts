import { ok, err, type Result } from 'super-result'
import { logger } from '../src/utils/logger.js'
import { config } from '../src/utils/config.js'
import { OllamaClient } from '../src/ai/ollama-client.js'

// ============================================================================
// Types
// ============================================================================

export interface KeywordData {
  keyword: string
  fileCount: number
  fileIds: Set<string>
}

export interface SemanticNode {
  id: string
  label: string
  keywords: string[]
  children: SemanticNode[]
  confidence: number
  fileCount: number
  level: number
}

export interface SemanticHierarchy {
  mode: 'topic-clusters' | 'full-hierarchy'
  version: string
  generatedAt: string
  root: SemanticNode
  stats: {
    totalKeywords: number
    totalClusters: number
    maxDepth: number
  }
}

export interface SemanticHierarchyResult {
  topicClusters: SemanticHierarchy
  fullHierarchy: SemanticHierarchy
}

// ============================================================================
// Configuration
// ============================================================================

const SEMANTIC_CONFIG = {
  MIN_KEYWORD_DF: 2,
  MAX_KEYWORDS_FOR_EMBEDDING: 800,
  EMBEDDING_BATCH_SIZE: 50,
  // Cosine similarity above which a keyword joins an existing cluster
  CLUSTER_SIMILARITY_THRESHOLD: 0.55,
  // Similarity above which two clusters merge into a common parent
  MERGE_SIMILARITY_THRESHOLD: 0.5,
  TARGET_TOPIC_CLUSTERS: 50,
  MIN_CLUSTER_SIZE: 2,
  MAX_HIERARCHY_DEPTH: 5,
  LLM_LABEL_BATCH_SIZE: 15,
  LLM_MAX_KEYWORDS_PER_GROUP: 5,
} as const

// ============================================================================
// Vector Math
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dim = vectors[0]!.length
  const result = new Array<number>(dim).fill(0)
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) result[i]! += vec[i]!
  }
  for (let i = 0; i < dim; i++) result[i]! /= vectors.length
  return result
}

// ============================================================================
// Co-occurrence Matrix (file-set Jaccard similarity)
// ============================================================================

export interface CooccurrenceMatrix {
  keywords: string[]
  matrix: number[][] // [0, 1]
}

/**
 * Build Jaccard similarity matrix from keyword-to-file mappings.
 * matrix[i][j] = |files_i ∩ files_j| / |files_i ∪ files_j|
 */
export function buildCooccurrenceMatrix(keywordData: KeywordData[]): CooccurrenceMatrix {
  const keywords = keywordData.map((kd) => kd.keyword)
  const n = keywords.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  const fileSets = keywordData.map((kd) => kd.fileIds)

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1
    const setI = fileSets[i]
    for (let j = i + 1; j < n; j++) {
      const setJ = fileSets[j]
      let intersection = 0
      for (const f of setI) {
        if (setJ.has(f)) intersection++
      }
      const union = setI.size + setJ.size - intersection
      const jaccard = union > 0 ? intersection / union : 0
      matrix[i][j] = jaccard
      matrix[j][i] = jaccard
    }
  }

  return { keywords, matrix }
}

/**
 * Get top co-occurring keywords for a given keyword index.
 */
export function getTopCooccurrences(
  matrix: CooccurrenceMatrix,
  keywordIndex: number,
  topK: number = 10
): Array<{ keyword: string; similarity: number }> {
  const { keywords, matrix: m } = matrix
  const row = m[keywordIndex]
  return row
    .map((similarity, idx) => ({ keyword: keywords[idx]!, similarity }))
    .filter((x) => x.keyword !== keywords[keywordIndex] && x.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}

// ============================================================================
// Embedding-based Clustering
// ============================================================================

interface Cluster {
  members: number[] // indices into keyword array
  centroid: number[]
}

/**
 * Greedy online clustering: process keywords in file-count order, assign each
 * to its most similar cluster centroid, or seed a new cluster when nothing
 * is close enough.
 */
export function clusterByEmbeddings(
  keywordData: KeywordData[],
  embeddings: number[][]
): number[][] {
  const clusters: Cluster[] = []
  // Process high-frequency keywords first so dense clusters form early
  const order = keywordData
    .map((_, idx) => idx)
    .sort((a, b) => keywordData[b]!.fileCount - keywordData[a]!.fileCount)

  for (const idx of order) {
    const vec = embeddings[idx]!
    let bestCluster = -1
    let bestSim = SEMANTIC_CONFIG.CLUSTER_SIMILARITY_THRESHOLD
    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSimilarity(vec, clusters[c]!.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestCluster = c
      }
    }
    if (bestCluster === -1) {
      clusters.push({ members: [idx], centroid: vec })
    } else {
      const cluster = clusters[bestCluster]!
      cluster.members.push(idx)
      cluster.centroid = centroid(cluster.members.map((m) => embeddings[m]!))
    }
  }

  // Sort clusters biggest-first for stable output
  clusters.sort((a, b) => b.members.length - a.members.length)
  return clusters.map((c) => c.members)
}

/**
 * Merge clusters into super-groups by centroid similarity. Returns a list of
 * groups; each group is a list of cluster indices.
 */
export function groupClusters(clusterCentroids: number[][]): number[][] {
  const groups: Array<{ clusterIndices: number[]; centroid: number[] }> = []
  for (let i = 0; i < clusterCentroids.length; i++) {
    const vec = clusterCentroids[i]!
    let bestGroup = -1
    let bestSim = SEMANTIC_CONFIG.MERGE_SIMILARITY_THRESHOLD
    for (let g = 0; g < groups.length; g++) {
      const sim = cosineSimilarity(vec, groups[g]!.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestGroup = g
      }
    }
    if (bestGroup === -1) {
      groups.push({ clusterIndices: [i], centroid: vec })
    } else {
      const group = groups[bestGroup]!
      group.clusterIndices.push(i)
      group.centroid = centroid(group.clusterIndices.map((c) => clusterCentroids[c]!))
    }
  }
  groups.sort((a, b) => b.clusterIndices.length - a.clusterIndices.length)
  return groups.map((g) => g.clusterIndices)
}

// ============================================================================
// Keyword Embedding
// ============================================================================

const ollamaClient = new OllamaClient(config)

export async function embedKeywords(keywords: string[]): Promise<Result<number[][], Error>> {
  const allEmbeddings: number[][] = []
  const batchSize = SEMANTIC_CONFIG.EMBEDDING_BATCH_SIZE
  const totalBatches = Math.ceil(keywords.length / batchSize)

  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize)
    const batchNo = Math.floor(i / batchSize) + 1
    logger.debug(`[semantic] Embedding batch ${batchNo}/${totalBatches} (${batch.length} keywords)`)

    const result = await ollamaClient.embed(batch)
    if (!result.ok) {
      return err(new Error(`Embedding failed: ${result.error.message}`))
    }
    allEmbeddings.push(...result.value)
  }

  logger.success(`[semantic] Embedded ${allEmbeddings.length} keywords`)
  return ok(allEmbeddings)
}

// ============================================================================
// LLM Labeling
// ============================================================================

/**
 * Ask the LLM for a short human-readable label for each keyword group.
 * Groups are sent in small batches; failures fall back to the top keywords.
 */
export async function labelGroups(groupKeywords: string[][]): Promise<Result<string[], Error>> {
  const labels: string[] = []
  const batchSize = SEMANTIC_CONFIG.LLM_LABEL_BATCH_SIZE

  for (let i = 0; i < groupKeywords.length; i += batchSize) {
    const batch = groupKeywords.slice(i, i + batchSize)
    const batchNo = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(groupKeywords.length / batchSize)
    logger.debug('[semantic] Labeling groups batch ' + batchNo + '/' + totalBatches)

    const groupsDesc = batch
      .map(
        (kws, idx) =>
          idx + 1 + '. ' + kws.slice(0, SEMANTIC_CONFIG.LLM_MAX_KEYWORDS_PER_GROUP).join(', ')
      )
      .join('\n')

    const prompt =
      'You are labeling topic clusters from a personal knowledge base. Each line lists the member keywords of one cluster.\n\n' +
      groupsDesc +
      '\n\nReply with exactly ' +
      batch.length +
      ' lines, one label per cluster, in the same order. Each label must be 2-4 words, Title Case, no numbering, no quotes, no explanations. Example:\nMachine Learning\nCloud Infrastructure\nDatabase Design'

    const result = await ollamaClient.generate(prompt)
    if (!result.ok) {
      return err(new Error(`LLM labeling failed: ${result.error.message}`))
    }

    const lines = result.value
      .split('\n')
      .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter((l) => l.length > 0)

    for (let j = 0; j < batch.length; j++) {
      labels.push(lines[j] ?? fallbackLabel(batch[j]!))
    }
  }

  return ok(labels)
}

function fallbackLabel(keywords: string[]): string {
  return keywords
    .slice(0, 2)
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join(' & ')
}

// ============================================================================
// Hierarchy Builders
// ============================================================================

function slugifyId(prefix: string, label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}:${slug}-${index}`
}

/**
 * Mode A: flat topic-cluster list under one root.
 */
export async function buildTopicClustersHierarchy(
  keywordData: KeywordData[],
  embeddings: number[][]
): Promise<Result<SemanticHierarchy, Error>> {
  logger.info('[semantic] Building Topic Clusters hierarchy (Mode A)...')

  const clusters = clusterByEmbeddings(keywordData, embeddings)
  const clusterKeywords = clusters.map((members) => members.map((m) => keywordData[m]!.keyword))

  const labelsResult = await labelGroups(clusterKeywords)
  if (!labelsResult.ok) return labelsResult

  const totalFiles = keywordData.reduce((sum, kd) => sum + kd.fileCount, 0)

  const children: SemanticNode[] = clusters.map((members, idx) => {
    const uniqueFiles = new Set<string>()
    for (const m of members) {
      for (const f of keywordData[m]!.fileIds) uniqueFiles.add(f)
    }
    return {
      id: slugifyId('semantic', labelsResult.value[idx]!, idx),
      label: labelsResult.value[idx]!,
      keywords: clusterKeywords[idx]!,
      children: [],
      confidence: 1,
      fileCount: uniqueFiles.size,
      level: 2,
    }
  })

  const hierarchy: SemanticHierarchy = {
    mode: 'topic-clusters',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    root: {
      id: 'semantic:root',
      label: 'All Topics',
      keywords: [],
      children,
      confidence: 1,
      fileCount: totalFiles,
      level: 1,
    },
    stats: {
      totalKeywords: keywordData.length,
      totalClusters: children.length,
      maxDepth: 2,
    },
  }

  logger.success(`[semantic] Topic Clusters: ${children.length} clusters`)
  return ok(hierarchy)
}

/**
 * Mode B: three-level tree - root -> super-groups -> clusters (keywords stay
 * attached to their cluster so clicking a topic can filter files).
 */
export async function buildFullHierarchy(
  keywordData: KeywordData[],
  embeddings: number[][]
): Promise<Result<SemanticHierarchy, Error>> {
  logger.info('[semantic] Building Full Hierarchy (Mode B)...')

  const clusters = clusterByEmbeddings(keywordData, embeddings)
  const clusterKeywords = clusters.map((members) => members.map((m) => keywordData[m]!.keyword))
  const clusterCentroids = clusters.map((members) => centroid(members.map((m) => embeddings[m]!)))

  // Label clusters and super-groups independently
  const clusterLabelsResult = await labelGroups(clusterKeywords)
  if (!clusterLabelsResult.ok) return clusterLabelsResult
  const clusterLabels = clusterLabelsResult.value

  const groups = groupClusters(clusterCentroids)
  // Super-group label prompt uses each group's top cluster keywords
  const groupKeywords = groups.map((clusterIndices) =>
    clusterIndices.flatMap((ci) => clusterKeywords[ci]!.slice(0, 6))
  )
  const groupLabelsResult = await labelGroups(groupKeywords)
  if (!groupLabelsResult.ok) return groupLabelsResult
  const groupLabels = groupLabelsResult.value

  const totalFiles = keywordData.reduce((sum, kd) => sum + kd.fileCount, 0)

  const children: SemanticNode[] = groups.map((clusterIndices, gIdx) => {
    const clusterNodes: SemanticNode[] = clusterIndices.map((ci) => {
      const uniqueFiles = new Set<string>()
      for (const m of clusters[ci]!) {
        for (const f of keywordData[m]!.fileIds) uniqueFiles.add(f)
      }
      return {
        id: slugifyId('semantic', clusterLabels[ci]!, ci),
        label: clusterLabels[ci]!,
        keywords: clusterKeywords[ci]!,
        children: [],
        confidence: 1,
        fileCount: uniqueFiles.size,
        level: 3,
      }
    })
    const groupFiles = new Set<string>()
    for (const c of clusterNodes) {
      for (const kw of c.keywords) {
        const kd = keywordData.find((k) => k.keyword === kw)
        if (kd) for (const f of kd.fileIds) groupFiles.add(f)
      }
    }
    return {
      id: slugifyId('semantic', groupLabels[gIdx]!, gIdx),
      label: groupLabels[gIdx]!,
      keywords: [],
      children: clusterNodes,
      confidence: 1,
      fileCount: groupFiles.size,
      level: 2,
    }
  })

  const hierarchy: SemanticHierarchy = {
    mode: 'full-hierarchy',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    root: {
      id: 'semantic:root-full',
      label: 'All Topics',
      keywords: [],
      children,
      confidence: 1,
      fileCount: totalFiles,
      level: 1,
    },
    stats: {
      totalKeywords: keywordData.length,
      totalClusters: clusters.length,
      maxDepth: 3,
    },
  }

  logger.success(`[semantic] Full Hierarchy: ${groups.length} groups, ${clusters.length} clusters`)
  return ok(hierarchy)
}

// ============================================================================
// Main Orchestration
// ============================================================================

export async function buildSemanticHierarchies(
  files: Array<{
    relativePath: string
    folder: string
    cleanName: string
    frontmatterTags: string[]
    contentKeywords: string[]
  }>
): Promise<Result<SemanticHierarchyResult, Error>> {
  // 1. Collect unique keywords with file mappings
  const keywordToFiles = new Map<string, Set<string>>()

  for (const f of files) {
    const allTags = [...new Set([...f.frontmatterTags, ...f.contentKeywords])]
    for (const tag of allTags) {
      if (!tag) continue
      if (!keywordToFiles.has(tag)) keywordToFiles.set(tag, new Set())
      keywordToFiles.get(tag)!.add(f.relativePath)
    }
  }

  // Filter by document frequency
  const filteredKeywords: KeywordData[] = []
  for (const [keyword, fileIds] of keywordToFiles.entries()) {
    if (fileIds.size < SEMANTIC_CONFIG.MIN_KEYWORD_DF) continue
    filteredKeywords.push({ keyword, fileCount: fileIds.size, fileIds })
  }

  // Limit keywords for embedding (cost/latency control)
  const keywordData = filteredKeywords
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, SEMANTIC_CONFIG.MAX_KEYWORDS_FOR_EMBEDDING)

  if (keywordData.length < SEMANTIC_CONFIG.MIN_CLUSTER_SIZE) {
    return err(
      new Error(`Not enough keywords (${keywordData.length}) to build a semantic hierarchy`)
    )
  }

  logger.info(
    `[semantic] Processing ${keywordData.length} keywords (from ${filteredKeywords.length} total, DF >= ${SEMANTIC_CONFIG.MIN_KEYWORD_DF})`
  )

  // 2. Embed keywords
  const embedResult = await embedKeywords(keywordData.map((kd) => kd.keyword))
  if (!embedResult.ok) return embedResult

  // 3. Build both hierarchy modes from the same embeddings
  const topicClustersResult = await buildTopicClustersHierarchy(keywordData, embedResult.value)
  if (!topicClustersResult.ok) return topicClustersResult

  const fullHierarchyResult = await buildFullHierarchy(keywordData, embedResult.value)
  if (!fullHierarchyResult.ok) return fullHierarchyResult

  return ok({
    topicClusters: topicClustersResult.value,
    fullHierarchy: fullHierarchyResult.value,
  })
}

// ============================================================================
// Cytoscape Conversion
// ============================================================================

interface SemanticCytoscapeElements {
  nodes: Array<{
    data: Record<string, unknown>
    classes?: string
  }>
  edges: Array<{
    data: Record<string, unknown>
    classes?: string
  }>
}

/**
 * Convert a SemanticHierarchy to Cytoscape elements using a mode-specific id
 * prefix so the two hierarchies never collide inside one graph.json.
 */
export function hierarchyToCytoscape(
  hierarchy: SemanticHierarchy,
  mode: 'topic-clusters' | 'full-hierarchy'
): SemanticCytoscapeElements {
  const prefix = mode === 'topic-clusters' ? 'sc' : 'sf'
  const nodes: SemanticCytoscapeElements['nodes'] = []
  const edges: SemanticCytoscapeElements['edges'] = []
  let edgeIndex = 0

  function traverse(node: SemanticNode, parentId?: string) {
    const isRoot = !parentId
    const isLeaf = node.keywords.length > 0
    const nodeId = `${prefix}:${node.id}`
    const kind = isRoot ? 'semantic-root' : isLeaf ? 'semantic-keyword' : 'semantic-topic'

    nodes.push({
      data: {
        id: nodeId,
        kind,
        label: node.label,
        title: isLeaf
          ? `${node.keywords.length} keywords, ${node.fileCount} files`
          : `${node.children.length} subtopics, ${node.fileCount} files`,
        tags: node.keywords,
        level: node.level,
        confidence: node.confidence,
        isRoot,
        mindmapMode: mode,
      },
      classes: isRoot
        ? 'cy-node-semantic-root'
        : isLeaf
          ? 'cy-node-semantic-keyword'
          : 'cy-node-semantic-topic',
    })

    if (parentId) {
      edges.push({
        data: {
          id: `${prefix}-tree:${edgeIndex++}`,
          source: parentId,
          target: nodeId,
          kind: 'semantic-tree',
        },
        classes: 'cy-edge-semantic-tree',
      })
    }

    for (const child of node.children) {
      traverse(child, nodeId)
    }
  }

  traverse(hierarchy.root)
  return { nodes, edges }
}
