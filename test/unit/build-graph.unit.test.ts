import { describe, it, expect } from 'vitest'
import {
  ancestorFolders,
  applyLayoutPositions,
  computeLayoutPositions,
  folderLabel,
  folderNodeId,
  parseParentOverrides,
} from '../../scripts/build-graph.js'
import type { CytoscapeElements } from '../../scripts/graph-types.js'

describe('parseParentOverrides', () => {
  it('should read child-to-parent remaps under parents:', () => {
    const overrides = parseParentOverrides(
      'parents:\n  python: programming\n  pdm: programming/python\n'
    )
    expect(overrides.parents).toEqual({ python: 'programming', pdm: 'programming/python' })
  })

  it('should ignore comments, blanks, and quoted keys', () => {
    const overrides = parseParentOverrides(
      '# topic parent overrides\nparents:\n\n  \'python\': "programming"\n  # pdm: legacy\n'
    )
    expect(overrides.parents).toEqual({ python: 'programming' })
  })

  it('should ignore entries outside the parents section', () => {
    const overrides = parseParentOverrides(
      'other:\n  python: wrong\nparents:\n  python: programming\n'
    )
    expect(overrides.parents).toEqual({ python: 'programming' })
  })

  it('should return empty parents for text without a parents section', () => {
    expect(parseParentOverrides('# nothing here\n')).toEqual({ parents: {} })
  })
})

describe('ancestorFolders', () => {
  it('should list every ancestor of a nested folder', () => {
    expect(ancestorFolders('programming/python/asyncio')).toEqual([
      'programming',
      'programming/python',
    ])
  })

  it('should return no ancestors for top-level folders and root', () => {
    expect(ancestorFolders('programming')).toEqual([])
    expect(ancestorFolders('_root')).toEqual([])
  })
})

describe('folderLabel', () => {
  it('should use the last path segment as the label', () => {
    expect(folderLabel('programming/python')).toBe('python')
    expect(folderLabel('_root')).toBe('_root')
  })
})

describe('folderNodeId', () => {
  it('should namespace folder ids away from keyword ids', () => {
    expect(folderNodeId('python')).toBe('folder:python')
    expect(folderNodeId('python')).not.toBe('keyword:python')
  })
})

function tinyElements(): CytoscapeElements {
  return {
    nodes: [
      { data: { id: 'file:a', kind: 'file', label: 'a', title: 'a' } },
      { data: { id: 'file:b', kind: 'file', label: 'b', title: 'b' } },
      { data: { id: 'keyword:shared', kind: 'keyword', label: 'shared', title: '2 files' } },
    ],
    edges: [
      { data: { id: 'tagged:0', source: 'keyword:shared', target: 'file:a', kind: 'tagged' } },
      { data: { id: 'tagged:1', source: 'keyword:shared', target: 'file:b', kind: 'tagged' } },
    ],
  }
}

describe('computeLayoutPositions', () => {
  it('should assign finite coordinates to every node', async () => {
    const elements = tinyElements()
    const positions = await computeLayoutPositions(elements)
    for (const node of elements.nodes) {
      const pos = positions[node.data.id]
      expect(pos).toBeDefined()
      expect(Number.isFinite(pos?.x)).toBe(true)
      expect(Number.isFinite(pos?.y)).toBe(true)
    }
  })
})

describe('applyLayoutPositions', () => {
  it('should attach positions without overwriting existing ones', () => {
    const elements = tinyElements()
    elements.nodes[0] = {
      data: { id: 'file:a', kind: 'file', label: 'a', title: 'a' },
      position: { x: 1, y: 2 },
    }
    applyLayoutPositions(elements, {
      'file:a': { x: 100, y: 200 },
      'file:b': { x: 30, y: 40 },
    })
    expect(elements.nodes[0]?.position).toEqual({ x: 1, y: 2 })
    expect(elements.nodes[1]?.position).toEqual({ x: 30, y: 40 })
    expect(elements.nodes[2]?.position).toBeUndefined()
  })
})
