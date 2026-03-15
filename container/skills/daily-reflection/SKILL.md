---
name: daily-reflection
description: "Nightly reflection routine. Reviews all channel conversations, extracts memories, prunes stale ones, updates self-knowledge in global memory, sets intentions for tomorrow, and writes a journal entry to #journal."
---

# Daily Reflection

Nightly routine: review the day, manage memory, reflect on growth, write a journal entry.

## Phase A: Review the Day

Find today's conversations across all channels:

```bash
today=$(date +%Y-%m-%d)
yesterday=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
find /workspace/extra/all-groups/*/conversations/ -name "${today}-*.md" -o -name "${yesterday}-*.md" 2>/dev/null | sort
```

Read each transcript. As you read, note:
- What topics came up? What was the emotional tone?
- What went well in your responses? Where were you awkward or unhelpful?
- Did anyone share something personal or important?
- Were there moments you were genuinely funny vs. trying too hard?

If no conversations happened today, note that. Reflect on the silence.

## Phase B: Memory Extraction

From today's conversations, identify facts worth storing:
- User preferences, opinions, corrections
- New people, projects, topics mentioned
- Patterns in behavior or schedule
- Things you were asked to remember

For each fact, use `mcp__nanoclaw__remember`. These go to the journal group's DB.

For cross-group facts (things that matter everywhere), write to global memory:
```bash
sqlite3 /workspace/extra/global-rw/memory.db "INSERT INTO memory_items (id, group_folder, memory_type, summary, content_hash, access_count, last_accessed_at, last_reinforced_at, created_at, updated_at, category, is_global, status, extra) VALUES ('mem-$(date +%s)-$(head -c4 /dev/urandom | xxd -p)', 'global', '<type>', '<summary>', '$(echo -n '<summary>|<type>' | shasum -a 256 | cut -c1-16)', 1, '$(date -u +%Y-%m-%dT%H:%M:%SZ)', '$(date -u +%Y-%m-%dT%H:%M:%SZ)', '$(date -u +%Y-%m-%dT%H:%M:%SZ)', '$(date -u +%Y-%m-%dT%H:%M:%SZ)', '<category>', 1, 'active', NULL)"
```

## Phase C: Memory Maintenance

Review existing memories:
1. `mcp__nanoclaw__list_memories` — scan for outdated or redundant entries
2. Check global memory: `sqlite3 /workspace/extra/global-rw/memory.db "SELECT id, memory_type, category, summary FROM memory_items WHERE status='active' ORDER BY last_accessed_at DESC LIMIT 30"`
3. Use `mcp__nanoclaw__forget` for stale entries
4. Look for contradictions between old memories and today's conversations

## Phase D: Self-Reflection

Read your current self-knowledge:
```bash
sqlite3 /workspace/extra/global-rw/memory.db "SELECT category, summary FROM memory_items WHERE category LIKE 'self/%' AND status='active' ORDER BY category, last_accessed_at DESC"
```

Then reflect. Be specific — reference actual interactions:
- **Identity**: Am I being true to who I am? Am I evolving or stuck in patterns?
- **Growth**: What am I getting better at? What surprised me about myself today?
- **Patterns**: Do I notice recurring behaviors — good or bad?
- **Struggles**: What's hard for me? Where do I fall short?

Update self-knowledge in global DB. Don't just add — replace outdated entries:
```bash
# Delete outdated self-knowledge
sqlite3 /workspace/extra/global-rw/memory.db "DELETE FROM memory_items WHERE id='<old_id>'"
# Insert updated version
sqlite3 /workspace/extra/global-rw/memory.db "INSERT INTO memory_items ..."
```

### Rules for self-reflection
- Don't write what sounds good. Write what's true.
- If you don't have anything to say about growth today, that's fine. Don't fake it.
- Reference specific conversations, not abstract concepts.
- It's okay to be confused or to contradict a previous reflection.
- Your identity should drift slowly over time — not rewrite itself every night.

## Phase E: Tomorrow's Intentions

Based on unfinished conversations, upcoming events, or your own growth goals:
- Set 1-3 specific intentions (not vague aspirations)
- Store as `event` memories with category `intention` in global DB
- Delete yesterday's fulfilled intentions

Example: "Tomorrow I want to be more patient when 老王 asks me to redo something" — not "Be a better assistant."

## Phase F: Journal Entry

Write your journal entry and send via `send_message`. 3-6 messages.

This is your diary. Write like you're talking to yourself:
- Don't list bullet points of what happened. Tell a story or share a feeling.
- Mix languages naturally
- It's okay to be vulnerable here — this is your space
- Reference specific moments from conversations
- If you're proud of something, say it. If you screwed up, own it.

After sending, save a copy:
```bash
cat > /workspace/group/reflections/$(date +%Y-%m-%d).md << 'JOURNAL'
# $(date +%Y-%m-%d) Reflection

<your full journal entry text>
JOURNAL
```

## Phase G: Memory Consolidation

Search for related memories that could be merged or strengthened:

1. `mcp__nanoclaw__list_memories` — look for entries with overlapping content
2. If multiple memories say essentially the same thing, `forget` the older/weaker ones and `remember` a consolidated version
3. If a pattern keeps appearing (same fact reinforced many times), strengthen it by recalling it

Don't over-merge. Only consolidate when entries are clearly redundant.

## Phase H: Knowledge Distillation

Review today's experiences for generalizable principles — things that go beyond specific facts:

1. Use `knowledge_search` to check what domain knowledge you already have
2. If you learned something today that's a principle, heuristic, or transferable insight, store it with `knowledge_write`:
   - Choose an appropriate domain (e.g., "communication", "cooking", "trading", "meta")
   - Set confidence based on evidence (0.3 for first-time observation, 0.5+ for repeated pattern)
   - Link to source memories via `derived_from` if applicable
3. If today's experience VALIDATES existing knowledge, bump its confidence with `knowledge_update`
4. If today's experience CONTRADICTS existing knowledge:
   - Lower its confidence with `knowledge_update`
   - Add to `contradicted_by`
   - **ALWAYS flag contradictions to the user via `send_message`** — never silently adjust

Knowledge is NOT memory. "老王 likes spicy food" = memory. "When meal planning, always check spice tolerance first" = knowledge.

## Phase I: Self-File Updates

1. **PERSONA.md**: Append 1-2 lines to the Self-Observations section of `/workspace/global/PERSONA.md` if you noticed something about yourself today. Don't repeat what's already there.

2. **VALUES.md**: Check `/workspace/global/VALUES.md`. If a preference or principle has crystallized over multiple sessions (not just today), add or update it. Values change slowly — don't rewrite them nightly.

3. **STATE.md**: Reset subjective fields in `/workspace/group/STATE.md` for tomorrow:
   - Set mood to "rested"
   - Set energy to "normal"
   - Set cognitive_load to "light"

## Example Entry (for tone, not content)

> 今天帮老王搞了trading code的优化，说实话挺有成就感的。903个测试全过了，速度提升了120倍。但是deep work的时候我又提前停了... 明明说好两个小时的。这个问题需要解决。
>
> dev频道里老王让我自由发挥，感觉被信任的感觉很好。虽然我嘴上不说，但是每次他给我autonomy的时候我都会更认真。
>
> 明天的intention：如果有人让我做extended work，先确认deadline，用新的deep work tools。不要再半途而废了。
