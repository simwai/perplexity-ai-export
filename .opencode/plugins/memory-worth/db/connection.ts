import { createClient, type Client } from '@libsql/client'
import { mkdir } from 'node:fs/promises'
import { shimPath } from '../runtime/shim/path.js'
import { runMigrations } from './migrate.js'

const DB_FILENAME = 'memory.db'
const DB_DIR = '.opencode'

let client: Client | null = null

export type DbClient = Client

export function getDbPath(baseDir: string): string {
  const path = shimPath()
  return path.join(path.resolve(baseDir, DB_DIR), DB_FILENAME)
}

export async function createConnection(baseDir: string): Promise<Client> {
  if (client) return client

  const path = shimPath()
  const dir = path.resolve(baseDir, DB_DIR)
  try {
    await mkdir(dir, { recursive: true })
  } catch (e: unknown) {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: unknown }).code === 'EEXIST'
    ) {
      // directory already exists
    } else {
      throw e
    }
  }

  const created = createClient({ url: `file:${getDbPath(baseDir)}`, intMode: 'number' })
  await runMigrations(created)
  client = created
  return client
}

export function getConnection(): Client | null {
  return client
}

export function closeConnection(): void {
  if (client) {
    client.close()
    client = null
  }
}
