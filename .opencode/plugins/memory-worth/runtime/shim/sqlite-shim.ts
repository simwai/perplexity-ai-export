import { IS_BUN, BUN } from '../detect.js'
import { isRecord } from '../../core/result.js'

export type SqliteDb = {
  kind: 'bun' | 'node'
  exec(script: string): void | Promise<void>
  queryObjects(sql: string, params: unknown[]): Array<Record<string, unknown>>
  close(): void | Promise<void>
}

function hiddenImport(specifier: string): Promise<unknown> {
  const loader = new Function('specifier', 'return import(specifier);')
  const loaded: unknown = loader(specifier)
  return loaded as Promise<unknown>
}

type BunDatabaseCtor = new (path: string) => {
  exec(script: string): void
  query(sql: string): { all(...params: unknown[]): unknown }
  close(): void
}

type NodeDatabaseCtor = new (path: string) => {
  exec(script: string): void
  prepare(sql: string): { all(...params: unknown[]): unknown }
  close(): void
}

function bunCtor(ns: unknown): BunDatabaseCtor | null {
  if (!isRecord(ns)) return null
  return typeof ns['Database'] === 'function' ? (ns['Database'] as BunDatabaseCtor) : null
}

function nodeCtor(ns: unknown): NodeDatabaseCtor | null {
  if (!isRecord(ns)) return null
  return typeof ns['DatabaseSync'] === 'function' ? (ns['DatabaseSync'] as NodeDatabaseCtor) : null
}

function toObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('sqlite-shim expected row array')
  const rows: Array<Record<string, unknown>> = []
  for (const row of value) {
    if (isRecord(row)) rows.push(row)
  }
  return rows
}

export async function openDatabase(path: string): Promise<SqliteDb> {
  if (IS_BUN && isRecord(BUN)) {
    const ns = await hiddenImport('bun:sqlite')
    const Ctor = bunCtor(ns)
    if (Ctor) {
      const db = new Ctor(path)
      return {
        kind: 'bun',
        exec: (script: string) => db.exec(script),
        queryObjects: (sql: string, params: unknown[]) => toObjects(db.query(sql).all(...params)),
        close: () => db.close(),
      }
    }
  }
  const ns = await import('node:sqlite')
  const Ctor = nodeCtor(ns)
  if (!Ctor) throw new Error('sqlite-shim node backend unavailable')
  const db = new Ctor(path)
  return {
    kind: 'node',
    exec: (script: string) => db.exec(script),
    queryObjects: (sql: string, params: unknown[]) => toObjects(db.prepare(sql).all(...params)),
    close: () => db.close(),
  }
}
