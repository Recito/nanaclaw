/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = process.env.NANOCLAW_IPC_BASE_DIR || '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;

// Memory database (per-group, mounted at /workspace/group/memory.db or via env)
const MEMORY_DB_PATH = process.env.NANOCLAW_MEMORY_DB || '/workspace/group/memory.db';
const MEMORY_TYPES = ['profile', 'event', 'knowledge', 'behavior', 'preference', 'skill'] as const;
type MemoryType = typeof MEMORY_TYPES[number];

function getMemoryDb(): Database.Database | null {
  try {
    const db = new Database(MEMORY_DB_PATH);
    db.pragma('journal_mode = WAL');
    return db;
  } catch {
    return null;
  }
}

function memoryContentHash(summary: string, memoryType: string): string {
  const normalized = `${summary.trim().toLowerCase().replace(/\s+/g, ' ')}|${memoryType}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function memorySalienceScore(accessCount: number, lastAccessedAt: string): number {
  const daysAgo = (Date.now() - new Date(lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
  const recency = daysAgo <= 0 ? 1.0 : Math.exp(-0.693 / 30 * daysAgo);
  const reinforcement = Math.log(Math.max(accessCount, 1) + 1);
  return reinforcement * recency;
}
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('New schedule type'),
    schedule_value: z.string().optional().describe('New schedule value (see schedule_task for format)'),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (args.schedule_type === 'cron' || (!args.schedule_type && args.schedule_value)) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}".` }],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.schedule_type !== undefined) data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined) data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} update requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z.string().describe('The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// --- Memory Tools ---

server.tool(
  'remember',
  `Store a memory about the user, a fact, preference, or anything worth retaining across conversations.

Memory types:
• profile: User characteristics, demographics, identity (name, age, role)
• event: Significant occurrences, milestones, notable happenings
• knowledge: Facts, learned information, understanding about topics
• behavior: Patterns, habits, routines, recurring actions
• preference: Likes, dislikes, choices, style preferences
• skill: User capabilities, competencies, expertise

Rules:
• Only store user-stated facts — not your suggestions or assumptions
• Each memory must be self-contained (understandable without conversation context)
• Don't store temporary/ephemeral info (current weather, today's mood)
• Preserve the user's language when possible
• If you store a fact that already exists, it will be reinforced (not duplicated)`,
  {
    summary: z.string().describe('The fact or information to remember. Should be a clear, self-contained statement.'),
    memory_type: z.enum(MEMORY_TYPES).default('knowledge').describe('Category of memory'),
    category: z.string().optional().describe('Optional topic tag (e.g., "food", "work", "family")'),
  },
  async (args) => {
    const db = getMemoryDb();
    if (!db) {
      return { content: [{ type: 'text' as const, text: 'Memory database not available.' }], isError: true };
    }

    try {
      const contentHash = memoryContentHash(args.summary, args.memory_type);
      const now = new Date().toISOString();

      // Check for duplicate
      const existing = db.prepare(
        `SELECT id, access_count FROM memory_items WHERE content_hash = ? AND group_folder = ? AND status = 'active'`
      ).get(contentHash, groupFolder) as { id: string; access_count: number } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE memory_items SET access_count = access_count + 1, last_accessed_at = ?, last_reinforced_at = ?, updated_at = ? WHERE id = ?`
        ).run(now, now, now, existing.id);
        return {
          content: [{ type: 'text' as const, text: `Memory reinforced (seen ${existing.access_count + 1}x): "${args.summary}"` }],
        };
      }

      const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(
        `INSERT INTO memory_items (id, group_folder, memory_type, summary, content_hash, access_count, last_accessed_at, last_reinforced_at, created_at, updated_at, category, is_global, status, extra)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 'active', NULL)`
      ).run(id, groupFolder, args.memory_type, args.summary, contentHash, now, now, now, now, args.category || null);

      return { content: [{ type: 'text' as const, text: `Remembered [${args.memory_type}]: "${args.summary}"` }] };
    } finally {
      db.close();
    }
  },
);

server.tool(
  'recall',
  `Search your memories for relevant information. Returns memories ranked by relevance and importance.

Use this when you need to look up something you've previously stored — user preferences, facts, past events, etc. Relevant memories are also auto-injected into your context, so you only need this for specific targeted searches.`,
  {
    query: z.string().describe('What to search for (keywords or natural language)'),
    memory_type: z.enum(MEMORY_TYPES).optional().describe('Filter by memory type'),
    limit: z.number().default(10).describe('Maximum results to return'),
  },
  async (args) => {
    const db = getMemoryDb();
    if (!db) {
      return { content: [{ type: 'text' as const, text: 'Memory database not available.' }], isError: true };
    }

    try {
      const limit = Math.min(args.limit, 25);
      const typeFilter = args.memory_type ? `AND m.memory_type = '${args.memory_type}'` : '';

      // FTS5 search
      const rows = db.prepare(
        `SELECT m.*, rank FROM memory_fts f
         JOIN memory_items m ON m.rowid = f.rowid
         WHERE memory_fts MATCH ? AND m.group_folder = ? AND m.status = 'active' ${typeFilter}
         ORDER BY rank LIMIT ?`
      ).all(args.query, groupFolder, limit * 3) as (Record<string, unknown> & { rank: number })[];

      if (rows.length === 0) {
        // Fallback: simple LIKE search
        const likeRows = db.prepare(
          `SELECT * FROM memory_items
           WHERE group_folder = ? AND status = 'active' AND summary LIKE ? ${typeFilter}
           ORDER BY last_accessed_at DESC LIMIT ?`
        ).all(groupFolder, `%${args.query}%`, limit) as Record<string, unknown>[];

        if (likeRows.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No memories found matching your query.' }] };
        }

        // Touch accessed items
        const now = new Date().toISOString();
        for (const row of likeRows) {
          db.prepare(`UPDATE memory_items SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?`)
            .run(now, now, row.id);
        }

        const formatted = likeRows.map((r) =>
          `• [${r.memory_type}] ${r.summary} (accessed ${r.access_count}x${r.category ? `, #${r.category}` : ''})`
        ).join('\n');
        return { content: [{ type: 'text' as const, text: `Memories (${likeRows.length} found):\n${formatted}` }] };
      }

      // Score and rank by salience
      interface ScoredRow { id: string; memory_type: string; summary: string; access_count: number; last_accessed_at: string; category: string | null; salience: number; }
      const scored: ScoredRow[] = rows.map((row) => ({
        id: row.id as string,
        memory_type: row.memory_type as string,
        summary: row.summary as string,
        access_count: row.access_count as number,
        last_accessed_at: row.last_accessed_at as string,
        category: (row.category as string) || null,
        salience: memorySalienceScore(row.access_count as number, row.last_accessed_at as string),
      }));
      scored.sort((a, b) => b.salience - a.salience);
      const top = scored.slice(0, limit);

      // Touch accessed items
      const now = new Date().toISOString();
      for (const row of top) {
        db.prepare(`UPDATE memory_items SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, row.id);
      }

      const formatted = top.map((r) =>
        `• [${r.memory_type}] ${r.summary} (accessed ${r.access_count + 1}x, salience: ${r.salience.toFixed(2)}${r.category ? `, #${r.category}` : ''})`
      ).join('\n');

      return { content: [{ type: 'text' as const, text: `Memories (${top.length} found):\n${formatted}` }] };
    } finally {
      db.close();
    }
  },
);

server.tool(
  'forget',
  'Remove a specific memory. Use when the user asks you to forget something or when information is outdated.',
  {
    query: z.string().describe('Search query to find the memory to forget, or the memory ID (mem-...) for exact match'),
  },
  async (args) => {
    const db = getMemoryDb();
    if (!db) {
      return { content: [{ type: 'text' as const, text: 'Memory database not available.' }], isError: true };
    }

    try {
      // Try exact ID match first
      if (args.query.startsWith('mem-')) {
        const result = db.prepare(
          `DELETE FROM memory_items WHERE id = ? AND group_folder = ?`
        ).run(args.query, groupFolder);
        if (result.changes > 0) {
          return { content: [{ type: 'text' as const, text: `Forgot memory ${args.query}.` }] };
        }
      }

      // FTS search to find matching memories
      const rows = db.prepare(
        `SELECT m.id, m.summary, m.memory_type FROM memory_fts f
         JOIN memory_items m ON m.rowid = f.rowid
         WHERE memory_fts MATCH ? AND m.group_folder = ? AND m.status = 'active'
         ORDER BY rank LIMIT 5`
      ).all(args.query, groupFolder) as { id: string; summary: string; memory_type: string }[];

      if (rows.length === 0) {
        // Fallback LIKE
        const likeRows = db.prepare(
          `SELECT id, summary, memory_type FROM memory_items
           WHERE group_folder = ? AND status = 'active' AND summary LIKE ?
           LIMIT 5`
        ).all(groupFolder, `%${args.query}%`) as { id: string; summary: string; memory_type: string }[];

        if (likeRows.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No matching memories found to forget.' }] };
        }

        if (likeRows.length === 1) {
          db.prepare(`DELETE FROM memory_items WHERE id = ?`).run(likeRows[0].id);
          return { content: [{ type: 'text' as const, text: `Forgot: [${likeRows[0].memory_type}] "${likeRows[0].summary}"` }] };
        }

        const list = likeRows.map((r) => `  ${r.id}: [${r.memory_type}] ${r.summary}`).join('\n');
        return { content: [{ type: 'text' as const, text: `Multiple matches found. Call forget again with the exact ID:\n${list}` }] };
      }

      if (rows.length === 1) {
        db.prepare(`DELETE FROM memory_items WHERE id = ?`).run(rows[0].id);
        return { content: [{ type: 'text' as const, text: `Forgot: [${rows[0].memory_type}] "${rows[0].summary}"` }] };
      }

      const list = rows.map((r) => `  ${r.id}: [${r.memory_type}] ${r.summary}`).join('\n');
      return { content: [{ type: 'text' as const, text: `Multiple matches found. Call forget again with the exact ID:\n${list}` }] };
    } finally {
      db.close();
    }
  },
);

server.tool(
  'list_memories',
  'List all stored memories, optionally filtered by type or category. Shows memory counts and summaries.',
  {
    memory_type: z.enum(MEMORY_TYPES).optional().describe('Filter by memory type'),
    category: z.string().optional().describe('Filter by category tag'),
  },
  async (args) => {
    const db = getMemoryDb();
    if (!db) {
      return { content: [{ type: 'text' as const, text: 'Memory database not available.' }], isError: true };
    }

    try {
      let sql = `SELECT * FROM memory_items WHERE group_folder = ? AND status = 'active'`;
      const params: unknown[] = [groupFolder];

      if (args.memory_type) {
        sql += ` AND memory_type = ?`;
        params.push(args.memory_type);
      }
      if (args.category) {
        sql += ` AND category = ?`;
        params.push(args.category);
      }
      sql += ` ORDER BY last_accessed_at DESC LIMIT 50`;

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No memories stored.' }] };
      }

      // Group count by type
      const countByType = db.prepare(
        `SELECT memory_type, COUNT(*) as count FROM memory_items WHERE group_folder = ? AND status = 'active' GROUP BY memory_type`
      ).all(groupFolder) as { memory_type: string; count: number }[];

      const totalCount = countByType.reduce((sum, r) => sum + r.count, 0);
      const typeSummary = countByType.map((r) => `${r.memory_type}: ${r.count}`).join(', ');

      const formatted = rows.map((r) => {
        const salience = memorySalienceScore(r.access_count as number, r.last_accessed_at as string);
        return `• [${r.memory_type}] ${r.summary} (${r.access_count}x, salience: ${salience.toFixed(2)}${r.category ? `, #${r.category}` : ''})`;
      }).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: `Memories: ${totalCount} total (${typeSummary})\n\n${formatted}`,
        }],
      };
    } finally {
      db.close();
    }
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
