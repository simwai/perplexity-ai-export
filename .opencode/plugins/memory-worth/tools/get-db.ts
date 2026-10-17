import type { Client } from '@libsql/client'
import { createConnection, getConnection } from '../db/connection.js'

export async function getToolDb(directory: string): Promise<Client> {
  return getConnection() ?? createConnection(directory)
}
