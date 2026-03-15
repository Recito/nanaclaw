/**
 * NanoClaw Host Agent Runner
 * Runs directly on the host (not in a container).
 * Same protocol as container agent-runner but with configurable paths via env vars.
 *
 * Required env vars:
 *   NANOCLAW_IPC_DIR      — path to IPC input directory
 *   NANOCLAW_WORK_DIR     — path to the group's working directory
 *   NANOCLAW_PROJECT_DIR  — path to the target project directory
 *   NANOCLAW_GLOBAL_DIR   — path to global memory directory (optional)
 *   NANOCLAW_GROUPS_DIR   — path to groups directory (for cross-channel reads)
 *   NANOCLAW_SESSIONS_DIR — path to per-group sessions directory
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  query,
  HookCallback,
  PreCompactHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;
const WORK_DIR = process.env.NANOCLAW_WORK_DIR || '/workspace/group';
const PROJECT_DIR = process.env.NANOCLAW_PROJECT_DIR || process.cwd();
const GLOBAL_DIR = process.env.NANOCLAW_GLOBAL_DIR || '';
const GROUPS_DIR = process.env.NANOCLAW_GROUPS_DIR || '';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

/** Deep work continuation delay — wait briefly before auto-continuing. */
const DEEP_WORK_CONTINUE_DELAY_MS = 3000;

interface DeepWorkState {
  deadline_unix: number;
  deadline_human: string;
  goal: string;
  plan: string[];
  completed: string[];
  current: string | null;
  started_at: string;
}

/**
 * Check if there's an active deep-work session with a future deadline.
 * Returns a continuation prompt if so, null otherwise.
 */
function checkDeepWorkContinuation(): string | null {
  const stateFile = path.join(WORK_DIR, 'deep_work.json');
  if (!fs.existsSync(stateFile)) return null;

  try {
    const state: DeepWorkState = JSON.parse(
      fs.readFileSync(stateFile, 'utf-8'),
    );
    const now = Math.floor(Date.now() / 1000);
    const remaining = state.deadline_unix - now;

    if (remaining <= 0) {
      log(
        `Deep work deadline passed (${state.deadline_human}), not continuing`,
      );
      return null;
    }

    const remainingMin = Math.round(remaining / 60);
    log(
      `Deep work active: ${remainingMin} min remaining until ${state.deadline_human}`,
    );

    const completedStr =
      state.completed.length > 0
        ? `\nCompleted so far: ${state.completed.join(', ')}`
        : '';
    const currentStr = state.current
      ? `\nWas working on: ${state.current}`
      : '';

    // Stronger nudge when lots of time remains
    const urgency =
      remainingMin > 120
        ? `\n\nIMPORTANT: You have ${Math.round(remainingMin / 60)} hours left. Do NOT wrap up or mark the session complete. Find new angles, run more experiments, go deeper. The user gave you this time — use it all.`
        : remainingMin > 30
          ? `\n\nYou still have ${remainingMin} minutes. Keep working — don't stop early.`
          : '';

    return [
      `[DEEP WORK CONTINUATION — Your context was compacted but your deep work session is still active]`,
      ``,
      `Read deep_work.json for your full state. Key info:`,
      `• Deadline: ${state.deadline_human} (~${remainingMin} min remaining)`,
      `• Goal: ${state.goal}`,
      `• Plan: ${state.plan.join(' → ')}`,
      `${completedStr}${currentStr}`,
      ``,
      `Run \`date\` to verify current time, then continue working. Do NOT re-announce the plan or re-read the full codebase — pick up where you left off.${urgency}`,
    ].join('\n');
  } catch (err) {
    log(
      `Failed to read deep_work.json: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[host-agent-runner] ${message}`);
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => {
        this.waiting = r;
      });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

function getSessionSummary(
  sessionId: string,
  transcriptPath: string,
): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) return null;

  try {
    const index: SessionsIndex = JSON.parse(
      fs.readFileSync(indexPath, 'utf-8'),
    );
    const entry = index.entries.find((e) => e.sessionId === sessionId);
    if (entry?.summary) return entry.summary;
  } catch {
    /* ignore */
  }

  return null;
}

function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) return {};

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);
      if (messages.length === 0) return {};

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = path.join(WORK_DIR, 'conversations');
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(
        messages,
        summary,
        assistantName,
      );
      fs.writeFileSync(filePath, markdown);
      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(
        `Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text =
          typeof entry.message.content === 'string'
            ? entry.message.content
            : entry.message.content
                .map((c: { text?: string }) => c.text || '')
                .join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return messages;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const lines: string[] = [];
  lines.push(
    `# ${title || 'Conversation'}`,
    '',
    `Archived: ${formatDateTime(now)}`,
    '',
    '---',
    '',
  );
  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content =
      msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...'
        : msg.content;
    lines.push(`**${sender}**: ${content}`, '');
  }
  return lines.join('\n');
}

async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}> {
  const stream = new MessageStream();
  stream.push(prompt);

  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Load global CLAUDE.md
  let globalClaudeMd: string | undefined;
  if (
    !containerInput.isMain &&
    GLOBAL_DIR &&
    fs.existsSync(path.join(GLOBAL_DIR, 'CLAUDE.md'))
  ) {
    globalClaudeMd = fs.readFileSync(
      path.join(GLOBAL_DIR, 'CLAUDE.md'),
      'utf-8',
    );
  }

  // Append memory context if available
  const memoryContextPath = path.join(WORK_DIR, 'memory_context.md');
  if (fs.existsSync(memoryContextPath)) {
    const memoryContext = fs.readFileSync(memoryContextPath, 'utf-8');
    if (memoryContext) {
      globalClaudeMd = (globalClaudeMd || '') + '\n\n' + memoryContext;
    }
  }

  // For host mode, additional directories include the project dir and groups dir
  const additionalDirs: string[] = [];
  if (GROUPS_DIR && fs.existsSync(GROUPS_DIR)) {
    // Add individual group dirs that exist (for cross-channel reads)
    for (const entry of fs.readdirSync(GROUPS_DIR)) {
      const fullPath = path.join(GROUPS_DIR, entry);
      if (fs.statSync(fullPath).isDirectory() && entry !== 'global') {
        additionalDirs.push(fullPath);
      }
    }
  }

  for await (const message of query({
    prompt: stream,
    options: {
      cwd: PROJECT_DIR,
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH || undefined,
      additionalDirectories:
        additionalDirs.length > 0 ? additionalDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: globalClaudeMd
        ? {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: globalClaudeMd,
          }
        : undefined,
      allowedTools: [
        'Bash',
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'Task',
        'TaskOutput',
        'TaskStop',
        'TeamCreate',
        'TeamDelete',
        'SendMessage',
        'TodoWrite',
        'ToolSearch',
        'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: process.execPath,
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
            NANOCLAW_IPC_BASE_DIR: path.dirname(IPC_INPUT_DIR),
            NANOCLAW_WORK_DIR: WORK_DIR,
            NANOCLAW_MEMORY_DB:
              process.env.NANOCLAW_MEMORY_DB ||
              path.join(WORK_DIR, 'memory.db'),
            NANOCLAW_GLOBAL_MEMORY_DB: GLOBAL_DIR
              ? path.join(GLOBAL_DIR, 'memory.db')
              : '',
          },
        },
      },
      hooks: {
        PreCompact: [
          { hooks: [createPreCompactHook(containerInput.assistantName)] },
        ],
      },
    },
  })) {
    messageCount++;
    const msgType =
      message.type === 'system'
        ? `system/${(message as { subtype?: string }).subtype}`
        : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult =
        'result' in message ? (message as { result?: string }).result : null;
      log(
        `Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`,
      );
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId,
      });
    }
  }

  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery };
}

// Prevent EPIPE crashes when parent closes the pipe
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    log(
      `Received input for group: ${containerInput.groupFolder} (host mode, project: ${PROJECT_DIR})`,
    );
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const sdkEnv: Record<string, string | undefined> = { ...process.env };

  // Symlink group-specific skills into ~/.claude/skills/ so the SDK finds them
  // without overriding CLAUDE_CONFIG_DIR (which breaks auth)
  const groupSkillsDir = path.join(
    process.env.NANOCLAW_DATA_DIR || path.join(process.cwd(), 'data'),
    'sessions',
    containerInput.groupFolder,
    '.claude',
    'skills',
  );
  const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  try {
    if (fs.existsSync(groupSkillsDir)) {
      const groupSkills = fs.readdirSync(groupSkillsDir);
      for (const skill of groupSkills) {
        const target = path.join(userSkillsDir, skill);
        const source = path.join(groupSkillsDir, skill);
        // Only symlink if not already present in user skills
        if (!fs.existsSync(target)) {
          fs.symlinkSync(source, target);
        }
      }
    }
  } catch (err) {
    // Non-fatal: skills may not load but auth will work
  }

  // MCP server is in the container agent-runner dist
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // __dirname is the nanoclaw dist/ dir; container agent-runner is relative to the project root
  const nanoclawRoot = path.dirname(__dirname);
  const containerMcp = path.join(
    nanoclawRoot,
    'container',
    'agent-runner',
    'dist',
    'ipc-mcp-stdio.js',
  );
  let mcpServerPath = '';
  if (fs.existsSync(containerMcp)) {
    mcpServerPath = containerMcp;
  } else {
    log('WARNING: MCP server not found, nanoclaw tools will be unavailable');
  }

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    /* ignore */
  }

  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  let resumeAt: string | undefined;
  try {
    while (true) {
      log(
        `Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`,
      );
      const queryResult = await runQuery(
        prompt,
        sessionId,
        mcpServerPath,
        containerInput,
        sdkEnv,
        resumeAt,
      );
      if (queryResult.newSessionId) sessionId = queryResult.newSessionId;
      if (queryResult.lastAssistantUuid)
        resumeAt = queryResult.lastAssistantUuid;

      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      // Check for active deep-work session — auto-continue if deadline is in the future
      const deepWorkPrompt = checkDeepWorkContinuation();
      if (deepWorkPrompt) {
        log(`Deep work auto-continuing in ${DEEP_WORK_CONTINUE_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, DEEP_WORK_CONTINUE_DELAY_MS));

        // Re-check in case user sent a message or close sentinel during the delay
        const urgentMessages = drainIpcInput();
        if (shouldClose()) {
          log('Close sentinel received during deep-work delay, exiting');
          break;
        }
        if (urgentMessages.length > 0) {
          log(
            `Got ${urgentMessages.length} IPC messages during delay, using those instead`,
          );
          prompt = urgentMessages.join('\n');
        } else {
          prompt = deepWorkPrompt;
        }
        continue;
      }

      log('Query ended, waiting for next IPC message...');

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
