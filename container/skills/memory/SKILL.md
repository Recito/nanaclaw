---
name: memory
description: Review, search, reorganize, or bulk-manage your stored memories. Use when you want to see what the agent remembers, add multiple facts at once, clean up or migrate legacy memory files, or search across all memories.
---

# Memory Management

Explicit memory operations. Use this skill when the user asks to review, search, organize, or bulk-edit memories.

## Operations

### Review (`/memory review`)
Show a summary of what's stored:
1. Use `mcp__nanoclaw__list_memories` to get all memories with counts by type
2. Show total count, breakdown by type and category
3. Show the top 10 most salient memories (highest relevance score)
4. Also check global memory at `/workspace/global/memory/` if it exists

### Search (`/memory search <query>`)
Search across all memories:
1. Use `mcp__nanoclaw__recall` with the query
2. Show results with type, category, and relevance score
3. Also search `/workspace/global/memory/` files (read-only)
4. If searching conversations too, add: `grep -ri "<query>" /workspace/group/conversations/`

### Store (`/memory store`)
Bulk-store facts from the current conversation:
1. Review the conversation so far
2. Identify all memorable facts (people, preferences, decisions, context)
3. Categorize each fact by type and category
4. Use `mcp__nanoclaw__remember` for each fact (dedup is automatic)
5. Confirm with ✍️ and list what was stored

### Reorganize (`/memory reorganize`)
Clean up and optimize memories:
1. Use `mcp__nanoclaw__list_memories` to see all entries
2. Use `mcp__nanoclaw__recall` to find duplicates or related entries
3. Use `mcp__nanoclaw__forget` to remove outdated or duplicate entries
4. Use `mcp__nanoclaw__remember` to store merged/improved versions
5. Report what changed

### Forget (`/memory forget <topic>`)
Remove specific memories:
1. Use `mcp__nanoclaw__recall` to search for the topic
2. Show the matching entries to the user
3. Ask for confirmation before deleting
4. Use `mcp__nanoclaw__forget` with the memory ID to remove confirmed entries

### Migrate (`/memory migrate`)
Migrate legacy file-based memories to the database:
1. Check if `memory/` directory exists with .md files
2. Read each file and extract individual facts
3. Use `mcp__nanoclaw__remember` for each fact (dedup prevents duplicates)
4. After migration, rename `memory/` to `memory_legacy/` as backup
5. Report what was migrated

## Memory Types

| Type | Use For |
|------|---------|
| `profile` | People, names, relationships, personal details |
| `event` | Things that happened, dates, milestones |
| `knowledge` | Facts, projects, technical details, accounts |
| `behavior` | How someone acts, communication style, patterns |
| `preference` | Likes, dislikes, habits, choices |
| `skill` | Abilities, expertise, tools someone uses |

## Tips

- One fact per `remember` call — keep entries atomic and concise
- Use categories for easy filtering: "food", "work", "people", "health"
- Duplicate detection is automatic — safe to re-store existing facts
- Memories decay over time if not accessed — frequently recalled memories stay salient
- The system auto-injects relevant memories at session start based on the user's prompt
