/**
 * Memory repository — CRUD operations with dedup and salience scoring.
 */
import Database from 'better-sqlite3';

import { computeContentHash } from './dedup.js';
import { salienceScore } from './salience.js';
import {
  CreateMemoryInput,
  MemoryItem,
  MemorySearchResult,
  MemoryType,
} from './types.js';

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function rowToItem(row: Record<string, unknown>): MemoryItem {
  return {
    id: row.id as string,
    group_folder: row.group_folder as string,
    memory_type: row.memory_type as MemoryType,
    summary: row.summary as string,
    content_hash: row.content_hash as string,
    access_count: row.access_count as number,
    last_accessed_at: row.last_accessed_at as string,
    last_reinforced_at: row.last_reinforced_at as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    category: (row.category as string) || null,
    is_global: (row.is_global as number) === 1,
    status: row.status as 'active' | 'archived',
    embedding: (row.embedding as Buffer) || null,
    extra: row.extra ? JSON.parse(row.extra as string) : null,
  };
}

/**
 * Create a memory item. If a duplicate exists (same content hash),
 * reinforce it instead of creating a new one.
 *
 * Returns the created or reinforced item.
 */
export function createItem(
  db: Database.Database,
  input: CreateMemoryInput,
): MemoryItem {
  const contentHash = computeContentHash(input.summary, input.memory_type);

  // Check for duplicate
  const existing = db
    .prepare(
      `SELECT * FROM memory_items
       WHERE content_hash = ? AND group_folder = ? AND status = 'active'`,
    )
    .get(contentHash, input.group_folder) as
    | Record<string, unknown>
    | undefined;

  if (existing) {
    return reinforceItem(db, existing.id as string);
  }

  const id = generateId();
  const timestamp = now();

  db.prepare(
    `INSERT INTO memory_items
     (id, group_folder, memory_type, summary, content_hash,
      access_count, last_accessed_at, last_reinforced_at,
      created_at, updated_at, category, is_global, status, extra)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    id,
    input.group_folder,
    input.memory_type,
    input.summary,
    contentHash,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
    input.category || null,
    input.is_global ? 1 : 0,
    input.extra ? JSON.stringify(input.extra) : null,
  );

  return getItemById(db, id)!;
}

/**
 * Reinforce an existing memory — bump access count and timestamps.
 */
export function reinforceItem(db: Database.Database, id: string): MemoryItem {
  const timestamp = now();
  db.prepare(
    `UPDATE memory_items
     SET access_count = access_count + 1,
         last_accessed_at = ?,
         last_reinforced_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(timestamp, timestamp, timestamp, id);

  return getItemById(db, id)!;
}

/**
 * Mark a memory as accessed (bumps last_accessed_at and access_count).
 */
export function touchItem(db: Database.Database, id: string): void {
  const timestamp = now();
  db.prepare(
    `UPDATE memory_items
     SET access_count = access_count + 1,
         last_accessed_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(timestamp, timestamp, id);
}

/**
 * Get a memory item by ID.
 */
export function getItemById(
  db: Database.Database,
  id: string,
): MemoryItem | undefined {
  const row = db.prepare(`SELECT * FROM memory_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToItem(row) : undefined;
}

/**
 * Delete a memory item by ID.
 */
export function deleteItem(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM memory_items WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Archive a memory item (soft delete).
 */
export function archiveItem(db: Database.Database, id: string): boolean {
  const result = db
    .prepare(
      `UPDATE memory_items SET status = 'archived', updated_at = ? WHERE id = ?`,
    )
    .run(now(), id);
  return result.changes > 0;
}

/**
 * List active memory items, optionally filtered by type and/or category.
 */
export function listItems(
  db: Database.Database,
  groupFolder: string,
  opts?: {
    memoryType?: MemoryType;
    category?: string;
    includeArchived?: boolean;
  },
): MemoryItem[] {
  let sql = `SELECT * FROM memory_items WHERE group_folder = ?`;
  const params: unknown[] = [groupFolder];

  if (!opts?.includeArchived) {
    sql += ` AND status = 'active'`;
  }
  if (opts?.memoryType) {
    sql += ` AND memory_type = ?`;
    params.push(opts.memoryType);
  }
  if (opts?.category) {
    sql += ` AND category = ?`;
    params.push(opts.category);
  }

  sql += ` ORDER BY last_accessed_at DESC`;

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

/**
 * Search memories using FTS5 full-text search, ranked by salience.
 */
export function searchByKeyword(
  db: Database.Database,
  groupFolder: string,
  query: string,
  opts?: { memoryType?: MemoryType; limit?: number },
): MemorySearchResult[] {
  const limit = opts?.limit ?? 10;

  // FTS5 search with rank
  const rows = db
    .prepare(
      `SELECT m.*, rank
       FROM memory_fts f
       JOIN memory_items m ON m.rowid = f.rowid
       WHERE memory_fts MATCH ?
         AND m.group_folder = ?
         AND m.status = 'active'
         ${opts?.memoryType ? 'AND m.memory_type = ?' : ''}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(
      ...[
        query,
        groupFolder,
        ...(opts?.memoryType ? [opts.memoryType] : []),
        limit * 3, // fetch extra for re-ranking by salience
      ],
    ) as (Record<string, unknown> & { rank: number })[];

  if (rows.length === 0) return [];

  // Normalize FTS5 rank scores to 0..1 (rank is negative, closer to 0 = better)
  const minRank = Math.min(...rows.map((r) => r.rank));
  const maxRank = Math.max(...rows.map((r) => r.rank));
  const rankRange = maxRank - minRank || 1;

  const results: MemorySearchResult[] = rows.map((row) => {
    const item = rowToItem(row);
    // Normalize: most relevant (most negative rank) → 1.0
    const similarity =
      rows.length === 1 ? 1.0 : 1.0 - (row.rank - minRank) / rankRange;
    const salience = salienceScore(
      similarity,
      item.access_count,
      item.last_accessed_at,
    );
    return { item, salience };
  });

  // Sort by salience descending and take top N
  results.sort((a, b) => b.salience - a.salience);
  return results.slice(0, limit);
}

/**
 * Get top-N most salient active memories for a group (no query filter).
 * Useful for auto-injection into prompts.
 */
export function getTopSalient(
  db: Database.Database,
  groupFolder: string,
  limit: number = 10,
): MemorySearchResult[] {
  const rows = db
    .prepare(
      `SELECT * FROM memory_items
       WHERE group_folder = ? AND status = 'active'
       ORDER BY last_accessed_at DESC
       LIMIT ?`,
    )
    .all(groupFolder, limit * 3) as Record<string, unknown>[];

  const results: MemorySearchResult[] = rows.map((row) => {
    const item = rowToItem(row);
    const salience = salienceScore(
      1.0, // no query similarity — weight all equally
      item.access_count,
      item.last_accessed_at,
    );
    return { item, salience };
  });

  results.sort((a, b) => b.salience - a.salience);
  return results.slice(0, limit);
}

/**
 * Find memories by content hash (for dedup checks).
 */
export function findByContentHash(
  db: Database.Database,
  groupFolder: string,
  contentHash: string,
): MemoryItem | undefined {
  const row = db
    .prepare(
      `SELECT * FROM memory_items
       WHERE content_hash = ? AND group_folder = ? AND status = 'active'`,
    )
    .get(contentHash, groupFolder) as Record<string, unknown> | undefined;
  return row ? rowToItem(row) : undefined;
}

/**
 * Count active memories for a group.
 */
export function countItems(db: Database.Database, groupFolder: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM memory_items
       WHERE group_folder = ? AND status = 'active'`,
    )
    .get(groupFolder) as { count: number };
  return row.count;
}

/**
 * Archive old unused memories.
 * Targets memories not accessed in maxAgeDays with fewer than minAccessCount accesses.
 */
export function decayOldMemories(
  db: Database.Database,
  groupFolder: string,
  maxAgeDays: number = 180,
  minAccessCount: number = 3,
): number {
  const cutoff = new Date(
    Date.now() - maxAgeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = db
    .prepare(
      `UPDATE memory_items
       SET status = 'archived', updated_at = ?
       WHERE group_folder = ?
         AND status = 'active'
         AND is_global = 0
         AND last_accessed_at < ?
         AND access_count < ?
         AND (category IS NULL OR category NOT LIKE 'self/%')`,
    )
    .run(now(), groupFolder, cutoff, minAccessCount);

  return result.changes;
}
