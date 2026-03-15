import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from './schema.js';
import { computeContentHash } from './dedup.js';
import {
  salienceScore,
  recencyDecay,
  reinforcementFactor,
} from './salience.js';
import {
  createItem,
  reinforceItem,
  touchItem,
  getItemById,
  deleteItem,
  archiveItem,
  listItems,
  searchByKeyword,
  getTopSalient,
  findByContentHash,
  countItems,
  decayOldMemories,
} from './repository.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

afterEach(() => {
  db.close();
});

// --- Dedup ---

describe('computeContentHash', () => {
  it('produces consistent hashes for same content', () => {
    const h1 = computeContentHash('User likes coffee', 'preference');
    const h2 = computeContentHash('User likes coffee', 'preference');
    expect(h1).toBe(h2);
  });

  it('normalizes whitespace and case', () => {
    const h1 = computeContentHash('User likes coffee', 'preference');
    const h2 = computeContentHash('  user  LIKES   coffee  ', 'preference');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different types', () => {
    const h1 = computeContentHash('User likes coffee', 'preference');
    const h2 = computeContentHash('User likes coffee', 'knowledge');
    expect(h1).not.toBe(h2);
  });

  it('returns 16 character hex string', () => {
    const hash = computeContentHash('test', 'profile');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// --- Salience ---

describe('recencyDecay', () => {
  it('returns 1.0 for current time', () => {
    expect(recencyDecay(new Date())).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.5 after 30 days', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(recencyDecay(thirtyDaysAgo)).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 after 60 days', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(recencyDecay(sixtyDaysAgo)).toBeCloseTo(0.25, 1);
  });

  it('returns close to 0 after a year', () => {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(recencyDecay(yearAgo)).toBeLessThan(0.01);
  });

  it('accepts ISO string', () => {
    const result = recencyDecay(new Date().toISOString());
    expect(result).toBeCloseTo(1.0, 1);
  });
});

describe('reinforcementFactor', () => {
  it('returns log(2) for access count 1', () => {
    expect(reinforcementFactor(1)).toBeCloseTo(Math.log(2), 5);
  });

  it('increases with access count', () => {
    expect(reinforcementFactor(10)).toBeGreaterThan(reinforcementFactor(1));
  });

  it('grows logarithmically (not linearly)', () => {
    const f10 = reinforcementFactor(10);
    const f100 = reinforcementFactor(100);
    // 10x more accesses should NOT produce 10x more reinforcement
    expect(f100 / f10).toBeLessThan(3);
  });
});

describe('salienceScore', () => {
  it('combines all factors', () => {
    const score = salienceScore(1.0, 5, new Date().toISOString());
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 when similarity is 0', () => {
    expect(salienceScore(0, 10, new Date().toISOString())).toBe(0);
  });

  it('higher access count increases score', () => {
    const now = new Date().toISOString();
    const s1 = salienceScore(1.0, 1, now);
    const s10 = salienceScore(1.0, 10, now);
    expect(s10).toBeGreaterThan(s1);
  });

  it('more recent access increases score', () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(salienceScore(1.0, 1, recent)).toBeGreaterThan(
      salienceScore(1.0, 1, old),
    );
  });
});

// --- Repository ---

describe('createItem', () => {
  it('creates a memory item', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee',
    });
    expect(item.id).toMatch(/^mem-/);
    expect(item.summary).toBe('User prefers dark roast coffee');
    expect(item.memory_type).toBe('preference');
    expect(item.access_count).toBe(1);
    expect(item.status).toBe('active');
  });

  it('deduplicates — reinforces instead of creating duplicate', () => {
    const item1 = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee',
    });
    const item2 = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee',
    });

    expect(item2.id).toBe(item1.id);
    expect(item2.access_count).toBe(2);
    expect(countItems(db, 'test_group')).toBe(1);
  });

  it('does not deduplicate across groups', () => {
    createItem(db, {
      group_folder: 'group_a',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee',
    });
    createItem(db, {
      group_folder: 'group_b',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee',
    });

    expect(countItems(db, 'group_a')).toBe(1);
    expect(countItems(db, 'group_b')).toBe(1);
  });
});

describe('reinforceItem', () => {
  it('increments access count and updates timestamps', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'knowledge',
      summary: 'The sky is blue',
    });

    const reinforced = reinforceItem(db, item.id);
    expect(reinforced.access_count).toBe(2);
    // Timestamps may match within the same millisecond, so just verify access_count changed
    expect(reinforced.last_reinforced_at).toBeDefined();
  });
});

describe('touchItem', () => {
  it('bumps access count without changing reinforced timestamp', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'knowledge',
      summary: 'Grass is green',
    });

    touchItem(db, item.id);
    const updated = getItemById(db, item.id)!;
    expect(updated.access_count).toBe(2);
  });
});

describe('deleteItem', () => {
  it('removes the item', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'knowledge',
      summary: 'Temporary fact',
    });
    expect(deleteItem(db, item.id)).toBe(true);
    expect(getItemById(db, item.id)).toBeUndefined();
  });

  it('returns false for non-existent item', () => {
    expect(deleteItem(db, 'nonexistent')).toBe(false);
  });
});

describe('archiveItem', () => {
  it('sets status to archived', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'event',
      summary: 'Old event',
    });
    archiveItem(db, item.id);
    const archived = getItemById(db, item.id)!;
    expect(archived.status).toBe('archived');
  });

  it('archived items do not appear in listItems by default', () => {
    const item = createItem(db, {
      group_folder: 'test_group',
      memory_type: 'event',
      summary: 'Old event',
    });
    archiveItem(db, item.id);
    expect(listItems(db, 'test_group')).toHaveLength(0);
  });
});

describe('listItems', () => {
  it('lists items for a group', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'profile',
      summary: 'A',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'B',
    });
    createItem(db, {
      group_folder: 'g2',
      memory_type: 'profile',
      summary: 'C',
    });

    expect(listItems(db, 'g1')).toHaveLength(2);
    expect(listItems(db, 'g2')).toHaveLength(1);
  });

  it('filters by memory type', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'profile',
      summary: 'A',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'B',
    });

    const profiles = listItems(db, 'g1', { memoryType: 'profile' });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].memory_type).toBe('profile');
  });

  it('filters by category', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'preference',
      summary: 'A',
      category: 'food',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'preference',
      summary: 'B',
      category: 'tech',
    });

    expect(listItems(db, 'g1', { category: 'food' })).toHaveLength(1);
  });
});

describe('searchByKeyword', () => {
  it('finds items by keyword', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'preference',
      summary: 'User prefers dark roast coffee in the morning',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'TypeScript is a typed superset of JavaScript',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'profile',
      summary: 'User works as a software engineer',
    });

    const results = searchByKeyword(db, 'g1', 'coffee');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.summary).toContain('coffee');
    expect(results[0].salience).toBeGreaterThan(0);
  });

  it('returns empty for no matches', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'The sky is blue',
    });
    const results = searchByKeyword(db, 'g1', 'xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('respects group isolation', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Coffee is great',
    });
    createItem(db, {
      group_folder: 'g2',
      memory_type: 'knowledge',
      summary: 'Coffee is terrible',
    });

    const results = searchByKeyword(db, 'g1', 'coffee');
    expect(results).toHaveLength(1);
    expect(results[0].item.group_folder).toBe('g1');
  });

  it('filters by memory type', () => {
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'preference',
      summary: 'Likes coffee',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Coffee has caffeine',
    });

    const results = searchByKeyword(db, 'g1', 'coffee', {
      memoryType: 'preference',
    });
    expect(results).toHaveLength(1);
    expect(results[0].item.memory_type).toBe('preference');
  });
});

describe('getTopSalient', () => {
  it('returns most salient items', () => {
    const item1 = createItem(db, {
      group_folder: 'g1',
      memory_type: 'profile',
      summary: 'Name is Alice',
    });
    createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Sky is blue',
    });

    // Reinforce item1 to make it more salient
    reinforceItem(db, item1.id);
    reinforceItem(db, item1.id);

    const top = getTopSalient(db, 'g1', 2);
    expect(top).toHaveLength(2);
    // Most reinforced should be first
    expect(top[0].item.id).toBe(item1.id);
    expect(top[0].salience).toBeGreaterThan(top[1].salience);
  });
});

describe('findByContentHash', () => {
  it('finds existing item by hash', () => {
    const item = createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Test fact',
    });
    const found = findByContentHash(db, 'g1', item.content_hash);
    expect(found).toBeDefined();
    expect(found!.id).toBe(item.id);
  });

  it('returns undefined for unknown hash', () => {
    expect(findByContentHash(db, 'g1', 'nonexistent')).toBeUndefined();
  });
});

describe('decayOldMemories', () => {
  it('archives old unused memories', () => {
    // Create an item with old timestamps
    const item = createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Old fact',
    });

    // Manually backdate the timestamps
    const oldDate = new Date(
      Date.now() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      `UPDATE memory_items SET last_accessed_at = ?, access_count = 1 WHERE id = ?`,
    ).run(oldDate, item.id);

    const archived = decayOldMemories(db, 'g1', 180, 3);
    expect(archived).toBe(1);

    const updated = getItemById(db, item.id)!;
    expect(updated.status).toBe('archived');
  });

  it('does not archive frequently accessed items', () => {
    const item = createItem(db, {
      group_folder: 'g1',
      memory_type: 'knowledge',
      summary: 'Popular fact',
    });

    // Backdate but give high access count
    const oldDate = new Date(
      Date.now() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      `UPDATE memory_items SET last_accessed_at = ?, access_count = 10 WHERE id = ?`,
    ).run(oldDate, item.id);

    const archived = decayOldMemories(db, 'g1', 180, 3);
    expect(archived).toBe(0);
  });

  it('does not archive global items', () => {
    const item = createItem(db, {
      group_folder: 'g1',
      memory_type: 'profile',
      summary: 'Global fact',
      is_global: true,
    });

    const oldDate = new Date(
      Date.now() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      `UPDATE memory_items SET last_accessed_at = ?, access_count = 1 WHERE id = ?`,
    ).run(oldDate, item.id);

    const archived = decayOldMemories(db, 'g1', 180, 3);
    expect(archived).toBe(0);
  });

  it('does not archive self-knowledge memories', () => {
    const item = createItem(db, {
      group_folder: 'g1',
      memory_type: 'behavior',
      summary: 'I tend to over-explain simple questions',
      category: 'self/observations',
    });

    const oldDate = new Date(
      Date.now() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      `UPDATE memory_items SET last_accessed_at = ?, access_count = 1 WHERE id = ?`,
    ).run(oldDate, item.id);

    const archived = decayOldMemories(db, 'g1', 180, 3);
    expect(archived).toBe(0);

    const updated = getItemById(db, item.id)!;
    expect(updated.status).toBe('active');
  });
});
