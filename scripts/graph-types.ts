// Shared Cytoscape element shapes for the knowledge-map pipeline.
// Single source of truth for scripts/build-graph.ts (builder) and any
// future script that reads or writes graph.json.

// #region Graph Types
export interface FileMeta {
  relativePath: string
  folder: string
  filename: string
  cleanName: string
  frontmatterTags: string[]
  contentKeywords: string[]
}

export interface NodePosition {
  x: number
  y: number
}

export interface CytoscapeNode {
  data: {
    id: string
    kind: 'file' | 'keyword' | 'folder' | 'semantic-root' | 'semantic-topic' | 'semantic-keyword'
    label: string
    title: string
    path?: string
    folder?: string
    tags?: string[]
    isFolder?: boolean
    isRoot?: boolean
    level?: number
    confidence?: number
  }
  // Precomputed headless-layout coordinates. The viewer renders them with
  // the instant preset layout; absent positions fall back to live cose.
  position?: NodePosition
  classes?: string
}

export interface CytoscapeEdge {
  data: {
    id: string
    source: string
    target: string
    kind:
      | 'wikilink'
      | 'tagged'
      | 'cofolder'
      | 'tree'
      | 'folder'
      | 'semantic-tree'
      | 'semantic-member'
  }
  classes?: string
}

export interface CytoscapeElements {
  nodes: CytoscapeNode[]
  edges: CytoscapeEdge[]
}
// #endregion Graph Types
