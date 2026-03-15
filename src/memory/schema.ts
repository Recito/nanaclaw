/**
 * Memory database schema — SQLite with FTS5 full-text search.
 */
import Database from 'better-sqlite3';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY,
    group_folder TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('profile','event','knowledge','behavior','preference','skill')),
    summary TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 1,
    last_accessed_at TEXT NOT NULL,
    last_reinforced_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    category TEXT,
    is_global INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    embedding BLOB,
    extra TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_memory_items_group ON memory_items(group_folder);
  CREATE INDEX IF NOT EXISTS idx_memory_items_type ON memory_items(memory_type);
  CREATE INDEX IF NOT EXISTS idx_memory_items_hash ON memory_items(content_hash);
  CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status);
  CREATE INDEX IF NOT EXISTS idx_memory_items_category ON memory_items(category);
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    summary,
    content='memory_items',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_items BEGIN
    INSERT INTO memory_fts(rowid, summary) VALUES (new.rowid, new.summary);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_items BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE OF summary ON memory_items BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
    INSERT INTO memory_fts(rowid, summary) VALUES (new.rowid, new.summary);
  END;
`;

const KNOWLEDGE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY,
    group_folder TEXT NOT NULL,
    domain TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5
      CHECK(confidence >= 0.0 AND confidence <= 1.0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_validated TEXT NOT NULL,
    derived_from TEXT,
    contradicted_by TEXT,
    is_global INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active','superseded','refuted'))
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge_entries(domain);
  CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_entries(status);
  CREATE INDEX IF NOT EXISTS idx_knowledge_global ON knowledge_entries(is_global);
`;

const KNOWLEDGE_FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, content,
    content='knowledge_entries',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_entries BEGIN
    INSERT INTO knowledge_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_entries BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
    AFTER UPDATE OF title, content ON knowledge_entries BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
    INSERT INTO knowledge_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
  END;
`;

export function applySchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.exec(FTS_SQL);
  db.exec(KNOWLEDGE_SCHEMA_SQL);
  db.exec(KNOWLEDGE_FTS_SQL);
}
