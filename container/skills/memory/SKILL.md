---
name: memory
description: Review, search, reorganize, or bulk-manage your stored memories. Use when you want to see what the agent remembers, add multiple facts at once, clean up memory files, or search across all memories.
---

# Memory Management

Explicit memory operations. Use this skill when the user asks to review, search, organize, or bulk-edit memories.

## Operations

### Review (`/memory review`)
Show a summary of what's stored:
1. Read `memory/index.md` for the overview
2. List each memory file with line count and last-modified date
3. Show a brief sample (first 5 entries) from each file
4. Also check global memory at `/workspace/global/memory/` if it exists

### Search (`/memory search <query>`)
Search across all memory files:
1. Use `grep -ri "<query>" /workspace/group/memory/` to find matches
2. Also search `/workspace/global/memory/` (read-only)
3. Show results with file name and matching lines
4. If searching conversations too, add: `grep -ri "<query>" /workspace/group/conversations/`

### Store (`/memory store`)
Bulk-store facts from the current conversation:
1. Review the conversation so far
2. Identify all memorable facts (people, preferences, decisions, context)
3. Categorize each fact into the appropriate file
4. Append to the relevant memory files
5. Update `memory/index.md` with changes
6. Confirm with ✍️ and list what was stored

### Reorganize (`/memory reorganize`)
Clean up and optimize memory files:
1. Read all files in `memory/`
2. Remove duplicates and outdated entries
3. Merge related entries
4. Split files over 300 lines into sub-files
5. Rebuild `memory/index.md`
6. Report what changed

### Forget (`/memory forget <topic>`)
Remove specific memories:
1. Search for the topic across memory files
2. Show the matching entries to the user
3. Ask for confirmation before deleting
4. Remove confirmed entries
5. Update `memory/index.md`

## File Conventions

- One fact per line or short paragraph
- Use `## Section` headers to group related facts within a file
- Date-stamp entries when temporal context matters: `(2026-03) Switched to new project X`
- Keep entries concise — this is reference material, not prose
- New files: lowercase, hyphenated (e.g., `work-projects.md`, `health.md`)
- Always update `memory/index.md` when creating or renaming files
