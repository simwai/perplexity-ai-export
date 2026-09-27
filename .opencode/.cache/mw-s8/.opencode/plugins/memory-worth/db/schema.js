"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATIONS = exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = 1;
exports.MIGRATIONS = [
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
            { sql: `INSERT OR IGNORE INTO memory_status (name) VALUES ('active'), ('archived'), ('invalidated'), ('merged')`, args: [] },
            { sql: `INSERT OR IGNORE INTO task_type (name) VALUES ('general')`, args: [] },
        ],
        params: [
            { key: "decay_rate", value: "0.3" },
            { key: "trust_quantile", value: "0.3" },
            { key: "doubt_quantile", value: "0.3" },
            { key: "min_evidence", value: "5" },
            { key: "active_partition", value: "general" },
        ],
    },
    {
        version: 2,
        statements: [
            `DROP TRIGGER IF EXISTS memory_ai`,
            `DROP TRIGGER IF EXISTS memory_ad`,
            `DROP TRIGGER IF EXISTS memory_au`,
            `DROP TABLE IF EXISTS memory_fts`,
            `ALTER TABLE memory RENAME TO memory_legacy_v1`,
            `ALTER TABLE memory_tag_link RENAME TO memory_tag_link_legacy_v1`,
            `ALTER TABLE memory_partition RENAME TO memory_partition_legacy_v1`,
            `ALTER TABLE outcome RENAME TO outcome_legacy_v1`,
            `ALTER TABLE tuning_param RENAME TO tuning_param_legacy_v1`,
            `ALTER TABLE tuning_audit RENAME TO tuning_audit_legacy_v1`,
            `ALTER TABLE tuning_audit_entry RENAME TO tuning_audit_entry_legacy_v1`,
            `ALTER TABLE session_memory RENAME TO session_memory_legacy_v1`,
            `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content=memory_legacy_v1, content_rowid=id)`,
            `CREATE TRIGGER IF NOT EXISTS memory_legacy_ai AFTER INSERT ON memory_legacy_v1 BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END`,
            `CREATE TRIGGER IF NOT EXISTS memory_legacy_ad AFTER DELETE ON memory_legacy_v1 BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END`,
            `CREATE TRIGGER IF NOT EXISTS memory_legacy_au AFTER UPDATE ON memory_legacy_v1 BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END`,
            `INSERT INTO memory_fts(rowid, content) SELECT id, content FROM memory_legacy_v1 WHERE id NOT IN (SELECT rowid FROM memory_fts)`,
            `CREATE TABLE IF NOT EXISTS memory_type (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
            `CREATE TABLE IF NOT EXISTS memory_tier (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
            `CREATE TABLE IF NOT EXISTS memory_source (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
            `CREATE TABLE IF NOT EXISTS ground_kind (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
            `CREATE TABLE IF NOT EXISTS edge_kind (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
            `CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        applies_when TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 50.0,
        s_plus REAL NOT NULL DEFAULT 1.0,
        s_minus REAL NOT NULL DEFAULT 0.0,
        mw REAL NOT NULL DEFAULT 0.5,
        usage_count INTEGER NOT NULL DEFAULT 0,
        project TEXT NOT NULL,
        topic TEXT,
        task_type_id INTEGER NOT NULL REFERENCES task_type(id),
        memory_type_id INTEGER NOT NULL REFERENCES memory_type(id),
        status_id INTEGER NOT NULL REFERENCES memory_status(id),
        tier_id INTEGER NOT NULL REFERENCES memory_tier(id),
        source_id INTEGER NOT NULL REFERENCES memory_source(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
            `CREATE TABLE IF NOT EXISTS memory_tag (
        memory_id INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
        PRIMARY KEY (memory_id, tag_id)
      )`,
            `CREATE TABLE IF NOT EXISTS ground (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
        ground_kind_id INTEGER NOT NULL REFERENCES ground_kind(id),
        value TEXT NOT NULL,
        fingerprint TEXT,
        verified_at INTEGER,
        UNIQUE (memory_id, ground_kind_id, value)
      )`,
            `CREATE TABLE IF NOT EXISTS edge (
        source_memory_id INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
        target_memory_id INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
        edge_kind_id INTEGER NOT NULL REFERENCES edge_kind(id),
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_memory_id, target_memory_id, edge_kind_id)
      )`,
            `CREATE TABLE IF NOT EXISTS episode (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_type_id INTEGER NOT NULL REFERENCES task_type(id),
        started_at INTEGER NOT NULL,
        resolved_at INTEGER,
        outcome INTEGER
      )`,
            `CREATE TABLE IF NOT EXISTS calibration_entry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
        memory_id INTEGER NOT NULL REFERENCES memory(id),
        mw_before REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (episode_id, memory_id)
      )`,
            `CREATE TABLE IF NOT EXISTS parameter (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
            `CREATE TABLE IF NOT EXISTS parameter_change (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knob TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        rationale TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      )`,
            `CREATE INDEX IF NOT EXISTS idx_memory_mw ON memory(mw)`,
            `CREATE INDEX IF NOT EXISTS idx_memory_task_type ON memory(task_type_id)`,
            `CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(project, topic)`,
            `CREATE INDEX IF NOT EXISTS idx_memory_status_id ON memory(status_id)`,
            `CREATE INDEX IF NOT EXISTS idx_memory_tag_tag ON memory_tag(tag_id)`,
            `CREATE INDEX IF NOT EXISTS idx_ground_memory ON ground(memory_id)`,
            `CREATE INDEX IF NOT EXISTS idx_edge_target ON edge(target_memory_id)`,
            `CREATE INDEX IF NOT EXISTS idx_edge_kind ON edge(edge_kind_id)`,
            `CREATE INDEX IF NOT EXISTS idx_episode_session ON episode(session_id)`,
            `CREATE INDEX IF NOT EXISTS idx_episode_unresolved ON episode(resolved_at) WHERE resolved_at IS NULL`,
            `CREATE INDEX IF NOT EXISTS idx_calibration_episode ON calibration_entry(episode_id)`,
            `CREATE INDEX IF NOT EXISTS idx_calibration_memory ON calibration_entry(memory_id)`,
            `CREATE INDEX IF NOT EXISTS idx_parameter_change_knob ON parameter_change(knob, changed_at)`,
        ],
        seed: [
            { sql: `INSERT OR IGNORE INTO memory_type (name) VALUES ('convention'), ('decision'), ('bugfix'), ('error'), ('reference'), ('note')`, args: [] },
            { sql: `INSERT OR IGNORE INTO memory_tier (name) VALUES ('L1'), ('L2'), ('L3')`, args: [] },
            { sql: `INSERT OR IGNORE INTO memory_source (name) VALUES ('session'), ('file'), ('tool'), ('user'), ('agent')`, args: [] },
            { sql: `INSERT OR IGNORE INTO ground_kind (name) VALUES ('file'), ('symbol'), ('git_ref')`, args: [] },
            { sql: `INSERT OR IGNORE INTO edge_kind (name) VALUES ('references'), ('supersedes'), ('contradicts')`, args: [] },
            { sql: `INSERT OR IGNORE INTO parameter (key, value) VALUES ('trust_q', '0.70'), ('doubt_q', '0.30'), ('min_evidence', '3'), ('active_partition', 'auto'), ('tune_interval', '50'), ('window_size', '50')`, args: [] },
        ],
    },
];
