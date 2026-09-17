import { tool } from '@opencode-ai/plugin'
import { renderMermaidSVG } from 'beautiful-mermaid'

export default tool({
  description: 'Render a Mermaid diagram to SVG and return a base64 data URL for embedding in chat',
  args: {
    code: tool.schema.string().describe('Mermaid diagram source code'),
  },
  async execute(args) {
    try {
      const svg = renderMermaidSVG(args.code, {
        bg: '#FFFFFF',
        fg: '#27272A',
        transparent: false,
      })

      const base64 = Buffer.from(svg).toString('base64')
      const dataUrl = `data:image/svg+xml;base64,${base64}`

      return `![diagram](${dataUrl})`
    } catch (error) {
      return `Error rendering Mermaid diagram: ${error.message}`
    }
  },
})
