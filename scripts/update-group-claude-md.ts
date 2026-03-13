#!/usr/bin/env tsx
/**
 * Update per-group CLAUDE.md files to use the new MCP memory tools
 * instead of legacy file-based memory instructions.
 *
 * Safe to run multiple times — skips files already updated.
 */
import fs from 'fs';
import path from 'path';

const GROUPS_DIR = path.join(process.cwd(), 'groups');

/** The new memory section to replace the old one. */
const NEW_MEMORY_SECTION = `## Memory

You have structured memory stored in a database. Relevant memories are automatically loaded into your context — check the "Relevant Memories" section if present.

### Memory Tools

- \`mcp__nanoclaw__remember\` — Store a memory (\`summary\`, \`memory_type\`, optional \`category\`)
- \`mcp__nanoclaw__recall\` — Search memories (\`query\`, optional \`memory_type\`, \`limit\`)
- \`mcp__nanoclaw__forget\` — Remove a memory (\`query_or_id\`)
- \`mcp__nanoclaw__list_memories\` — Browse all (optional \`memory_type\`, \`category\`)

Memory types: \`profile\`, \`event\`, \`knowledge\`, \`behavior\`, \`preference\`, \`skill\`

### When to READ (use \`recall\`)
- Before answering personal questions (names, preferences, history)
- When someone references past context ("like last time", "the usual")
- At the start of tasks involving people or preferences
- After reading memory, include 🤔 at the start of your response so the user knows you checked

### When to WRITE (use \`remember\`)
- User shares personal info (name, birthday, preferences, contacts)
- User corrects you — store the correction immediately
- You learn something important about a person, project, or recurring topic
- User explicitly says "remember this"
- After writing memory, include ✍️ at the start of your response so the user knows you saved something

### Rules
- One fact per \`remember\` call — keep entries concise and atomic
- Duplicate detection is automatic — safe to re-store existing facts
- Use \`/memory\` skill for bulk operations (review, reorganize, migrate)
- \`conversations/\` has past session transcripts — grep for detailed recall`;

/**
 * Patterns that indicate old file-based memory instructions.
 */
const OLD_MEMORY_PATTERNS = [
  'memory/index.md',
  'memory/people.md',
  'memory/preferences.md',
  'memory/facts.md',
  'Read `memory/',
  'memory in `memory/`',
  'Append to existing files',
];

/** Check if a CLAUDE.md has already been updated. */
function isAlreadyUpdated(content: string): boolean {
  return content.includes('mcp__nanoclaw__remember') || content.includes('mcp__nanoclaw__recall');
}

/** Check if a CLAUDE.md has old file-based memory instructions. */
function hasOldMemorySection(content: string): boolean {
  return OLD_MEMORY_PATTERNS.some((p) => content.includes(p));
}

/**
 * Replace the old ## Memory section with the new one.
 * Handles various section endings (next ## header or end of file).
 */
function replaceMemorySection(content: string): string {
  // Find the ## Memory section
  const memoryStart = content.indexOf('## Memory');
  if (memoryStart === -1) return content;

  // Find the end of the memory section (next ## header or end of file)
  const afterMemory = content.slice(memoryStart + '## Memory'.length);
  const nextSectionMatch = afterMemory.match(/\n## [A-Z]/);
  let memoryEnd: number;
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    memoryEnd = memoryStart + '## Memory'.length + nextSectionMatch.index;
  } else {
    // Memory section goes to end of file — but check for ### Global memory subsection too
    memoryEnd = content.length;
  }

  const before = content.slice(0, memoryStart);
  const after = content.slice(memoryEnd);

  return before + NEW_MEMORY_SECTION + '\n' + after;
}

// --- Main ---
const groups = fs.readdirSync(GROUPS_DIR).filter((d) => {
  const claudeMd = path.join(GROUPS_DIR, d, 'CLAUDE.md');
  return fs.existsSync(claudeMd);
});

let updated = 0;
let skipped = 0;
let noMemory = 0;

for (const group of groups) {
  const claudeMd = path.join(GROUPS_DIR, group, 'CLAUDE.md');
  const content = fs.readFileSync(claudeMd, 'utf-8');

  if (isAlreadyUpdated(content)) {
    console.log(`  ${group}: already updated, skipping`);
    skipped++;
    continue;
  }

  if (!hasOldMemorySection(content)) {
    console.log(`  ${group}: no memory section found, skipping`);
    noMemory++;
    continue;
  }

  const newContent = replaceMemorySection(content);
  if (newContent === content) {
    console.log(`  ${group}: no changes needed`);
    skipped++;
    continue;
  }

  fs.writeFileSync(claudeMd, newContent);
  console.log(`  ${group}: ✓ updated memory section`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} already current, ${noMemory} no memory section`);
