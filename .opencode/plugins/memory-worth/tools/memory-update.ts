import { tool } from '@opencode-ai/plugin'
import { asNumber } from '../db/decode.js'
import { epochNow } from '../db/epoch.js'
import { getToolDb } from './get-db.js'

export const memoryUpdateTool = tool({
  description: "Update a memory's content. Preserves accumulated trust scores.",
  args: {
    id: tool.schema.number().describe('Memory ID to update'),
    content: tool.schema.string().describe('New content'),
    tags: tool.schema.string().optional().describe('Updated tags (comma-separated)'),
  },
  async execute(args, context) {
    const content = args.content.trim()
    if (!content) return { output: 'Error: content is required' }
    const db = await getToolDb(context.directory)

    const existing = await db.execute({
      sql: `SELECT id FROM memory WHERE id = ? AND deleted_at IS NULL`,
      args: [args.id],
    })
    if (existing.rows.length === 0) return { output: `Error: Memory ${args.id} not found` }

    const now = epochNow()
    if (args.tags === undefined) {
      await db.execute({
        sql: `UPDATE memory SET content = ?, updated_at = ? WHERE id = ?`,
        args: [content, now, args.id],
      })
      return { output: JSON.stringify({ updated: true, id: args.id }) }
    }

    const tagNames: string[] = []
    for (const part of args.tags.split(',')) {
      const name = part.trim()
      if (name) tagNames.push(name)
    }

    const writes: Array<{ sql: string; args: Array<string | number | null> }> = [
      {
        sql: `UPDATE memory SET content = ?, updated_at = ? WHERE id = ?`,
        args: [content, now, args.id],
      },
      { sql: `DELETE FROM memory_tag_link WHERE memory_id = ?`, args: [args.id] },
    ]
    for (const tagName of tagNames) {
      writes.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] })
    }
    await db.batch(writes, 'write')

    if (tagNames.length > 0) {
      const placeholders = tagNames.map(() => '?').join(', ')
      const tagRows = await db.execute({
        sql: `SELECT id FROM tag WHERE name IN (${placeholders})`,
        args: tagNames,
      })
      const links: Array<{ sql: string; args: Array<string | number | null> }> = []
      for (const row of tagRows.rows) {
        links.push({
          sql: `INSERT OR IGNORE INTO memory_tag_link (memory_id, tag_id) VALUES (?, ?)`,
          args: [args.id, asNumber(row['id'])],
        })
      }
      await db.batch(links, 'write')
    }
    return { output: JSON.stringify({ updated: true, id: args.id }) }
  },
})
