/**
 * Knowledge store — CRUD operations for domain knowledge entries.
 * Uses SQLite + FTS5, same pattern as memory repository.
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';

import {
  CreateKnowledgeInput,
  KnowledgeEntry,
  KnowledgeSearchOptions,
  UpdateKnowledgeInput,
} from './knowledge-types.js';

function generateId(): string {
  return `know-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Hash title+domain for dedup. Same normalization as memory dedup.
 */
function computeKnowledgeHash(title: string, domain: string): string {
  const normalized = `${title.toLowerCase().trim().replace(/\s+/g, ' ')}|${domain.toLowerCase().trim()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function rowToEntry(row: Record<string, unknown>): KnowledgeEntry {
  return {
    id: row.id as string,
    group_folder: row.group_folder as string,
    domain: row.domain as string,
    title: row.title as string,
    content: row.content as string,
    confidence: row.confidence as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_validated: row.last_validated as string,
    derived_from: row.derived_from
      ? (JSON.parse(row.derived_from as string) as string[])
      : null,
    contradicted_by: row.contradicted_by
      ? (JSON.parse(row.contradicted_by as string) as string[])
      : null,
    is_global: (row.is_global as number) === 1,
    status: row.status as KnowledgeEntry['status'],
  };
}

/**
 * Create a knowledge entry. Deduplicates on title+domain hash —
 * if a match exists, updates content and bumps last_validated instead.
 */
export function createKnowledge(
  db: Database.Database,
  input: CreateKnowledgeInput,
): KnowledgeEntry {
  const hash = computeKnowledgeHash(input.title, input.domain);

  // Check for existing entry with same title+domain
  const existing = db
    .prepare(
      `SELECT * FROM knowledge_entries
       WHERE group_folder = ? AND domain = ? AND status = 'active'
       AND id IN (
         SELECT id FROM knowledge_entries WHERE id IN (
           SELECT id FROM knowledge_entries
           WHERE group_folder = ? AND domain = ?
         )
       )`,
    )
    .all(input.group_folder, input.domain, input.group_folder, input.domain) as
    | Record<string, unknown>[]
    | undefined;

  // Simple dedup: check if title hash matches any existing entry
  if (existing) {
    for (const row of existing) {
      const existingHash = computeKnowledgeHash(
        row.title as string,
        row.domain as string,
      );
      if (existingHash === hash) {
        // Update existing entry instead of creating duplicate
        return updateKnowledge(db, row.id as string, {
          content: input.content,
          confidence: input.confidence,
          last_validated: now(),
        });
      }
    }
  }

  const id = generateId();
  const timestamp = now();

  db.prepare(
    `INSERT INTO knowledge_entries
     (id, group_folder, domain, title, content, confidence,
      created_at, updated_at, last_validated, derived_from, is_global, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    id,
    input.group_folder,
    input.domain,
    input.title,
    input.content,
    input.confidence ?? 0.5,
    timestamp,
    timestamp,
    timestamp,
    input.derived_from ? JSON.stringify(input.derived_from) : null,
    input.is_global ? 1 : 0,
  );

  return getKnowledgeById(db, id)!;
}

/**
 * Update a knowledge entry. Returns the updated entry.
 */
export function updateKnowledge(
  db: Database.Database,
  id: string,
  updates: UpdateKnowledgeInput,
): KnowledgeEntry {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now()];

  if (updates.confidence !== undefined) {
    fields.push('confidence = ?');
    values.push(updates.confidence);
  }
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.contradicted_by !== undefined) {
    fields.push('contradicted_by = ?');
    values.push(JSON.stringify(updates.contradicted_by));
  }
  if (updates.last_validated !== undefined) {
    fields.push('last_validated = ?');
    values.push(updates.last_validated);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  values.push(id);
  db.prepare(
    `UPDATE knowledge_entries SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);

  return getKnowledgeById(db, id)!;
}

/**
 * Search knowledge entries using FTS5 full-text search.
 */
export function searchKnowledge(
  db: Database.Database,
  groupFolder: string,
  query: string,
  opts: KnowledgeSearchOptions = {},
): KnowledgeEntry[] {
  const limit = opts.limit ?? 10;
  const minConfidence = opts.minConfidence ?? 0;

  // Build WHERE clause for group scope
  const conditions: string[] = ["k.status = 'active'"];
  const params: unknown[] = [];

  if (opts.includeGlobal) {
    conditions.push('(k.group_folder = ? OR k.is_global = 1)');
    params.push(groupFolder);
  } else {
    conditions.push('k.group_folder = ?');
    params.push(groupFolder);
  }

  if (opts.domain) {
    conditions.push('k.domain = ?');
    params.push(opts.domain);
  }

  if (minConfidence > 0) {
    conditions.push('k.confidence >= ?');
    params.push(minConfidence);
  }

  const whereClause = conditions.join(' AND ');

  // Try FTS5 search first
  if (query.trim()) {
    try {
      const ftsQuery = query
        .replace(/[^\w\s\u4e00-\u9fff]/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(' OR ');

      if (ftsQuery) {
        const rows = db
          .prepare(
            `SELECT k.*, rank
             FROM knowledge_entries k
             JOIN knowledge_fts f ON k.rowid = f.rowid
             WHERE f.knowledge_fts MATCH ? AND ${whereClause}
             ORDER BY rank
             LIMIT ?`,
          )
          .all(ftsQuery, ...params, limit) as Record<string, unknown>[];

        return rows.map(rowToEntry);
      }
    } catch {
      /* fall through to LIKE search */
    }
  }

  // Fallback: LIKE search on title and content
  if (query.trim()) {
    const rows = db
      .prepare(
        `SELECT k.*
         FROM knowledge_entries k
         WHERE ${whereClause}
           AND (k.title LIKE ? OR k.content LIKE ?)
         ORDER BY k.confidence DESC, k.updated_at DESC
         LIMIT ?`,
      )
      .all(...params, `%${query}%`, `%${query}%`, limit) as Record<
      string,
      unknown
    >[];

    return rows.map(rowToEntry);
  }

  // No query — return top entries by confidence
  const rows = db
    .prepare(
      `SELECT k.*
       FROM knowledge_entries k
       WHERE ${whereClause}
       ORDER BY k.confidence DESC, k.updated_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

/**
 * List all knowledge entries for a group, optionally filtered by domain.
 */
export function listKnowledge(
  db: Database.Database,
  groupFolder: string,
  opts: { domain?: string; includeGlobal?: boolean } = {},
): KnowledgeEntry[] {
  const conditions: string[] = ["k.status = 'active'"];
  const params: unknown[] = [];

  if (opts.includeGlobal) {
    conditions.push('(k.group_folder = ? OR k.is_global = 1)');
    params.push(groupFolder);
  } else {
    conditions.push('k.group_folder = ?');
    params.push(groupFolder);
  }

  if (opts.domain) {
    conditions.push('k.domain = ?');
    params.push(opts.domain);
  }

  const rows = db
    .prepare(
      `SELECT k.*
       FROM knowledge_entries k
       WHERE ${conditions.join(' AND ')}
       ORDER BY k.domain, k.confidence DESC`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

/**
 * Get a single knowledge entry by ID.
 */
export function getKnowledgeById(
  db: Database.Database,
  id: string,
): KnowledgeEntry | undefined {
  const row = db
    .prepare('SELECT * FROM knowledge_entries WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;

  return row ? rowToEntry(row) : undefined;
}
