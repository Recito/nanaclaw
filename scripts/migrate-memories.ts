#!/usr/bin/env tsx
/**
 * Migrate legacy file-based memories (memory/*.md) to SQLite memory.db.
 *
 * Usage:
 *   npx tsx scripts/migrate-memories.ts                  # migrate all groups
 *   npx tsx scripts/migrate-memories.ts discord_main     # migrate one group
 *   npx tsx scripts/migrate-memories.ts --dry-run        # preview without writing
 *
 * After migration, the original memory/ directory is renamed to memory_legacy/.
 */
import fs from 'fs';
import path from 'path';

import { getMemoryDb } from '../src/memory/db.js';
import { createItem, countItems } from '../src/memory/repository.js';
import { MemoryType, MEMORY_TYPES } from '../src/memory/types.js';

const GROUPS_DIR = path.join(process.cwd(), 'groups');

interface ParsedMemory {
  summary: string;
  memory_type: MemoryType;
  category: string | null;
  is_global: boolean;
}

/** Map legacy file names to memory types. */
function fileToType(filename: string): MemoryType {
  const name = path.basename(filename, '.md').toLowerCase();
  switch (name) {
    case 'people': return 'profile';
    case 'self': return 'profile';
    case 'preferences': return 'preference';
    case 'facts': return 'knowledge';
    default: return 'knowledge';
  }
}

/** Map legacy file names to categories. */
function fileToCategory(filename: string): string | null {
  const name = path.basename(filename, '.md').toLowerCase();
  switch (name) {
    case 'people': return 'people';
    case 'self': return 'self-concept';
    case 'preferences': return 'preferences';
    case 'facts': return 'facts';
    default: return name;
  }
}

/**
 * Parse a markdown memory file into individual memory entries.
 * Each line starting with "- " is a separate memory.
 * Multi-line content under ## headers gets grouped.
 */
function parseMemoryFile(
  content: string,
  filename: string,
  groupFolder: string,
): ParsedMemory[] {
  const memoryType = fileToType(filename);
  const category = fileToCategory(filename);
  const isGlobal = groupFolder === 'global';
  const memories: ParsedMemory[] = [];
  const lines = content.split('\n');

  let currentSection = '';
  let multiLineBuffer: string[] = [];

  const flushBuffer = () => {
    if (multiLineBuffer.length === 0) return;
    const text = multiLineBuffer.join('\n').trim();
    if (text && text.length > 5) {
      // For multi-line entries, prepend section context
      const summary = currentSection
        ? `[${currentSection}] ${text}`
        : text;
      memories.push({ summary, memory_type: memoryType, category, is_global: isGlobal });
    }
    multiLineBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip the top-level title (# People, # Preferences, etc.)
    if (/^#\s+/.test(trimmed) && !trimmed.startsWith('##')) continue;

    // Section headers
    if (trimmed.startsWith('## ')) {
      flushBuffer();
      currentSection = trimmed.replace(/^##\s+/, '');
      continue;
    }

    // Skip index tables and empty lines
    if (trimmed.startsWith('| ') || trimmed === '' || trimmed === '---') {
      if (trimmed === '' && multiLineBuffer.length > 0) {
        flushBuffer();
      }
      continue;
    }

    // Bullet points are individual memories
    if (trimmed.startsWith('- ')) {
      flushBuffer();
      const text = trimmed.replace(/^-\s+/, '').trim();
      // Skip HTML comment templates (e.g., "<!-- Add entries: ... -->")
      if (text.length > 3 && !text.startsWith('<!--')) {
        const summary = currentSection
          ? `${currentSection}: ${text}`
          : text;
        memories.push({ summary, memory_type: memoryType, category, is_global: isGlobal });
      }
      continue;
    }

    // Non-bullet content (prose, self.md style) — buffer for multi-line
    if (trimmed.length > 0) {
      multiLineBuffer.push(trimmed);
    }
  }

  flushBuffer();
  return memories;
}

function migrateGroup(groupFolder: string, dryRun: boolean): { migrated: number; skipped: number } {
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  const memoryDir = path.join(groupDir, 'memory');

  if (!fs.existsSync(memoryDir)) {
    return { migrated: 0, skipped: 0 };
  }

  const files = fs.readdirSync(memoryDir).filter(
    (f) => f.endsWith('.md') && f !== 'index.md',
  );

  if (files.length === 0) {
    return { migrated: 0, skipped: 0 };
  }

  console.log(`\n--- ${groupFolder} ---`);
  console.log(`  Found ${files.length} memory files: ${files.join(', ')}`);

  const allMemories: ParsedMemory[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
    const parsed = parseMemoryFile(content, file, groupFolder);
    console.log(`  ${file}: ${parsed.length} entries`);
    allMemories.push(...parsed);
  }

  if (allMemories.length === 0) {
    console.log('  No memories to migrate');
    return { migrated: 0, skipped: 0 };
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would migrate ${allMemories.length} memories:`);
    for (const m of allMemories) {
      const preview = m.summary.length > 80
        ? m.summary.slice(0, 80) + '...'
        : m.summary;
      console.log(`    [${m.memory_type}] ${preview}`);
    }
    return { migrated: allMemories.length, skipped: 0 };
  }

  // Open/create the memory database
  const db = getMemoryDb(groupDir);
  const beforeCount = countItems(db, groupFolder);

  let migrated = 0;
  let skipped = 0;

  for (const m of allMemories) {
    try {
      const item = createItem(db, {
        group_folder: groupFolder,
        memory_type: m.memory_type,
        summary: m.summary,
        category: m.category ?? undefined,
        is_global: m.is_global,
      });
      // createItem returns reinforced item if duplicate — check if it's new
      if (item.access_count === 1) {
        migrated++;
      } else {
        skipped++; // duplicate — reinforced existing
      }
    } catch (err) {
      console.error(`  ERROR migrating: ${m.summary.slice(0, 60)} — ${err}`);
      skipped++;
    }
  }

  const afterCount = countItems(db, groupFolder);
  console.log(`  Migrated: ${migrated} new, ${skipped} duplicates/skipped`);
  console.log(`  DB count: ${beforeCount} -> ${afterCount}`);

  // Rename memory/ to memory_legacy/
  const legacyDir = path.join(groupDir, 'memory_legacy');
  if (!fs.existsSync(legacyDir)) {
    fs.renameSync(memoryDir, legacyDir);
    console.log(`  Renamed memory/ -> memory_legacy/`);
  } else {
    console.log(`  memory_legacy/ already exists, keeping both`);
  }

  return { migrated, skipped };
}

// --- Main ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const specificGroup = args.find((a) => !a.startsWith('--'));

console.log(`Memory Migration Tool`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log(`Valid types: ${MEMORY_TYPES.join(', ')}`);

let totalMigrated = 0;
let totalSkipped = 0;

if (specificGroup) {
  const result = migrateGroup(specificGroup, dryRun);
  totalMigrated += result.migrated;
  totalSkipped += result.skipped;
} else {
  // Migrate all groups
  const groups = fs.readdirSync(GROUPS_DIR).filter((d) => {
    const stat = fs.statSync(path.join(GROUPS_DIR, d));
    return stat.isDirectory() && fs.existsSync(path.join(GROUPS_DIR, d, 'memory'));
  });

  console.log(`\nGroups with memory/: ${groups.join(', ')}`);

  for (const group of groups) {
    const result = migrateGroup(group, dryRun);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
  }
}

console.log(`\n=== Summary ===`);
console.log(`Migrated: ${totalMigrated}`);
console.log(`Skipped/Duplicates: ${totalSkipped}`);
if (dryRun) {
  console.log(`\nRun without --dry-run to apply changes.`);
}
