/**
 * Memory database initialization.
 * Each group gets its own memory.db file.
 */
import Database from 'better-sqlite3';
import path from 'path';

import { applySchema } from './schema.js';

const openDbs = new Map<string, Database.Database>();

/**
 * Open (or create) the memory database for a group.
 * Caches connections per group folder path.
 */
export function getMemoryDb(groupDir: string): Database.Database {
  const dbPath = path.join(groupDir, 'memory.db');

  const cached = openDbs.get(dbPath);
  if (cached) return cached;

  const db = new Database(dbPath);
  applySchema(db);
  openDbs.set(dbPath, db);
  return db;
}

/**
 * Open a memory database at an explicit path.
 * Used by MCP tools inside containers where the path is known.
 */
export function openMemoryDb(dbPath: string): Database.Database {
  const cached = openDbs.get(dbPath);
  if (cached) return cached;

  const db = new Database(dbPath);
  applySchema(db);
  openDbs.set(dbPath, db);
  return db;
}

/**
 * Close all open memory database connections.
 */
export function closeAllMemoryDbs(): void {
  for (const db of openDbs.values()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  openDbs.clear();
}
