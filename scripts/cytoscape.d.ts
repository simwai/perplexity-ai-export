// Minimal ambient types for the cytoscape surface used headlessly by
// scripts/build-graph.ts. Covers layout-run + position-read only; extend
// (or adopt @types/cytoscape) if scripts ever need more of the API.
declare module 'cytoscape' {
  interface HeadlessLayout {
    one(event: 'layoutstop', handler: () => void): void
    run(): void
  }

  interface PositionedElement {
    position(): { x: number; y: number }
  }

  interface HeadlessInstance {
    layout(options: { name: string; animate?: boolean; padding?: number }): HeadlessLayout
    getElementById(id: string): PositionedElement
    destroy(): void
  }

  function cytoscape(options: {
    elements: {
      nodes: Array<{ data: { id: string } }>
      edges: Array<{ data: { id: string; source: string; target: string } }>
    }
    headless?: boolean
    styleEnabled?: boolean
  }): HeadlessInstance

  export default cytoscape
}
