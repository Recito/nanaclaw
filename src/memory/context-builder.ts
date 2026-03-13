/**
 * Build memory context to auto-inject into agent prompts.
 * Runs on the host before spawning the agent.
 */
import fs from 'fs';
import path from 'path';

import { getMemoryDb } from './db.js';
import { searchByKeyword, getTopSalient } from './repository.js';
import { GROUPS_DIR } from '../config.js';
import { MemorySearchResult } from './types.js';
import { logger } from '../logger.js';

const MAX_CONTEXT_CHARS = 2000;
const MAX_ITEMS = 10;

/** Simple keyword extraction: split on whitespace, remove stopwords and short words. */
function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'about',
    'that',
    'this',
    'it',
    'its',
    'and',
    'or',
    'but',
    'not',
    'no',
    'if',
    'then',
    'so',
    'up',
    'out',
    'just',
    'also',
    'very',
    'what',
    'how',
    'when',
    'where',
    'who',
    'which',
    'why',
    'my',
    'your',
    'me',
    'you',
    'i',
    'we',
    'they',
    'he',
    'she',
    'him',
    'her',
    'them',
    'our',
    'their',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
}

function formatMemoryItem(r: MemorySearchResult): string {
  const typeTag = r.item.memory_type;
  const category = r.item.category ? ` #${r.item.category}` : '';
  return `- [${typeTag}] ${r.item.summary}${category}`;
}

/**
 * Read legacy memory/*.md files and extract bullet-point entries.
 * Returns an array of individual memory strings.
 */
function readLegacyMemoryFiles(memoryDir: string): string[] {
  const entries: string[] = [];
  const files = fs
    .readdirSync(memoryDir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md');
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') && trimmed.length > 5) {
          entries.push(trimmed.replace(/^-\s+/, ''));
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return entries;
}

/**
 * Build a memory context string for injection into the agent's prompt.
 * Searches the group's memory DB using keywords from the prompt,
 * plus top salient memories as fallback.
 */
export function buildMemoryContext(
  groupFolder: string,
  prompt: string,
  groupDir: string,
): string {
  try {
    const db = getMemoryDb(groupDir);
    const results: MemorySearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. Search by keywords from the prompt
    const keywords = extractKeywords(prompt);
    if (keywords.length > 0) {
      // Try FTS5 with OR-joined keywords
      const ftsQuery = keywords.slice(0, 5).join(' OR ');
      try {
        const ftsResults = searchByKeyword(db, groupFolder, ftsQuery, {
          limit: MAX_ITEMS,
        });
        for (const r of ftsResults) {
          if (!seenIds.has(r.item.id)) {
            seenIds.add(r.item.id);
            results.push(r);
          }
        }
      } catch {
        // FTS5 query may fail on special characters; fall through to top salient
      }
    }

    // 2. Fill remaining slots with top salient memories
    if (results.length < MAX_ITEMS) {
      const remaining = MAX_ITEMS - results.length;
      const topItems = getTopSalient(db, groupFolder, remaining + 5);
      for (const r of topItems) {
        if (!seenIds.has(r.item.id) && results.length < MAX_ITEMS) {
          seenIds.add(r.item.id);
          results.push(r);
        }
      }
    }

    // 3. Also include global memories if available
    if (groupFolder !== 'global') {
      const globalDir = path.join(GROUPS_DIR, 'global');
      const globalDbPath = path.join(globalDir, 'memory.db');
      if (fs.existsSync(globalDbPath)) {
        // Prefer database-backed global memories
        try {
          const globalDb = getMemoryDb(globalDir);
          const globalItems = getTopSalient(globalDb, 'global', 5);
          for (const r of globalItems) {
            if (!seenIds.has(r.item.id) && results.length < MAX_ITEMS + 5) {
              seenIds.add(r.item.id);
              results.push(r);
            }
          }
        } catch {
          // Global memory DB not available, skip
        }
      } else {
        // Fallback: read legacy global memory/*.md files
        const globalMemDir = path.join(globalDir, 'memory');
        if (fs.existsSync(globalMemDir)) {
          try {
            const globalLines = readLegacyMemoryFiles(globalMemDir);
            for (const line of globalLines.slice(0, 5)) {
              results.push({
                item: {
                  id: `global-legacy-${results.length}`,
                  group_folder: 'global',
                  memory_type: 'knowledge',
                  summary: line,
                  content_hash: '',
                  access_count: 1,
                  last_accessed_at: new Date().toISOString(),
                  last_reinforced_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  category: null,
                  is_global: true,
                  status: 'active',
                  embedding: null,
                  extra: null,
                },
                salience: 0.5,
              });
            }
          } catch {
            // Legacy files not readable, skip
          }
        }
      }
    }

    if (results.length === 0) return '';

    // Sort final results by salience
    results.sort((a, b) => b.salience - a.salience);

    // Format and truncate
    const lines = ['## Relevant Memories'];
    let totalChars = lines[0].length;

    for (const r of results) {
      const line = formatMemoryItem(r);
      if (totalChars + line.length + 1 > MAX_CONTEXT_CHARS) break;
      lines.push(line);
      totalChars += line.length + 1;
    }

    return lines.length > 1 ? lines.join('\n') : '';
  } catch (err) {
    logger.debug({ err, groupFolder }, 'Failed to build memory context');
    return '';
  }
}
