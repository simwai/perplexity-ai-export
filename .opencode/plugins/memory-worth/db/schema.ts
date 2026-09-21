export const SCHEMA_VERSION = 1

export type MigrationSeed = {
  sql: string
  args: Array<string | number | null>
}

export type MigrationParam = {
  key: string
  value: string
}

export type Migration = {
  version: number
  statements: string[]
  seed?: MigrationSeed[]
  params?: MigrationParam[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS task_type (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS tag (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        ema_success REAL NOT NULL DEFAULT 0.5,
        ema_failure REAL NOT NULL DEFAULT 0.5,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        memory_status_id INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')),
        deleted_at TEXT,
        FOREIGN KEY (memory_status_id) REFERENCES memory_status(id)
      )`,
      `CREATE TABLE IF NOT EXISTS memory_tag_link (
        memory_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (memory_id, tag_id),
        FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS memory_partition (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        task_type_id INTEGER NOT NULL,
        ema_success REAL NOT NULL DEFAULT 0.5,
        ema_failure REAL NOT NULL DEFAULT 0.5,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE,
        FOREIGN KEY (task_type_id) REFERENCES task_type(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS outcome (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        memory_id INTEGER,
        task_type_id INTEGER NOT NULL,
        outcome INTEGER NOT NULL CHECK (outcome IN (0, 1)),
        logged_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (memory_id) REFERENCES memory(id),
        FOREIGN KEY (task_type_id) REFERENCES task_type(id)
      )`,
      `CREATE TABLE IF NOT EXISTS tuning_param (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%s', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS tuning_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        changed_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')),
        changed_by TEXT,
        rationale TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tuning_audit_entry (
        audit_id INTEGER NOT NULL,
        param_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        PRIMARY KEY (audit_id, param_key),
        FOREIGN KEY (audit_id) REFERENCES tuning_audit(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS session_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        memory_id INTEGER NOT NULL,
        retrieved_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE
      )`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        content=memory,
        content_rowid=id
      )`,
      `CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END`,
      `CREATE INDEX IF NOT EXISTS idx_memory_memory_status_id ON memory(memory_status_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_deleted_at ON memory(deleted_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_tag_link_memory_id ON memory_tag_link(memory_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_tag_link_tag_id ON memory_tag_link(tag_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_partition_memory_id ON memory_partition(memory_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_partition_task_type_id ON memory_partition(task_type_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outcome_session_id ON outcome(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outcome_memory_id ON outcome(memory_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outcome_task_type_id ON outcome(task_type_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tuning_audit_entry_audit_id ON tuning_audit_entry(audit_id)`,
      `CREATE INDEX IF NOT EXISTS idx_session_memory_session_id ON session_memory(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_session_memory_memory_id ON session_memory(memory_id)`,
    ],
    seed: [
      {
        sql: `INSERT OR IGNORE INTO memory_status (name) VALUES ('active'), ('archived'), ('invalidated'), ('merged')`,
        args: [],
      },
      { sql: `INSERT OR IGNORE INTO task_type (name) VALUES ('general')`, args: [] },
    ],
    params: [
      { key: 'decay_rate', value: '0.3' },
      { key: 'trust_quantile', value: '0.3' },
      { key: 'doubt_quantile', value: '0.3' },
      { key: 'min_evidence', value: '5' },
      { key: 'active_partition', value: 'general' },
    ],
  },
]
