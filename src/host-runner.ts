/**
 * Host Runner for NanoClaw
 * Runs the agent-runner script directly on the host (no container).
 * Enables full dev work: running tests, git operations, npm commands, etc.
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
} from './config.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { detectAuthMode } from './credential-proxy.js';
import { findAllowedRoot, loadMountAllowlist } from './mount-security.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

// Must match agent-runner
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

/**
 * Find the Claude Code CLI executable on the host.
 */
function resolveClaudeCodePath(): string | null {
  // Explicit env var takes priority
  if (
    process.env.CLAUDE_CODE_PATH &&
    fs.existsSync(process.env.CLAUDE_CODE_PATH)
  ) {
    return process.env.CLAUDE_CODE_PATH;
  }
  // Check common locations
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Search npx cache
  const npxCache = path.join(process.env.HOME || '', '.npm', '_npx');
  if (fs.existsSync(npxCache)) {
    try {
      for (const entry of fs.readdirSync(npxCache)) {
        const cliPath = path.join(
          npxCache,
          entry,
          'node_modules',
          '@anthropic-ai',
          'claude-code',
          'cli.js',
        );
        if (fs.existsSync(cliPath)) return cliPath;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Validate that the project directory is allowed for host execution.
 * Returns an error message if invalid, null if ok.
 */
export function validateHostProjectDir(projectDir: string): string | null {
  if (!path.isAbsolute(projectDir)) {
    return `projectDir must be absolute, got: "${projectDir}"`;
  }
  if (!fs.existsSync(projectDir)) {
    return `projectDir does not exist: "${projectDir}"`;
  }
  const stat = fs.statSync(projectDir);
  if (!stat.isDirectory()) {
    return `projectDir is not a directory: "${projectDir}"`;
  }
  // Validate against mount allowlist
  const allowlist = loadMountAllowlist();
  if (!allowlist) {
    return `No mount allowlist configured — host mode requires an allowlist with the project directory listed`;
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync(projectDir);
  } catch {
    return `Cannot resolve real path for: "${projectDir}"`;
  }
  const root = findAllowedRoot(realPath, allowlist.allowedRoots);
  if (!root) {
    return `projectDir "${realPath}" is not under any allowed root in mount allowlist`;
  }
  return null;
}

export async function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, processName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const hostConfig = group.hostConfig;
  if (!hostConfig?.projectDir) {
    return {
      status: 'error',
      result: null,
      error: 'Host mode requires hostConfig.projectDir',
    };
  }

  // Validate project directory
  const validationError = validateHostProjectDir(hostConfig.projectDir);
  if (validationError) {
    logger.error(
      { group: group.name, projectDir: hostConfig.projectDir },
      `Host runner validation failed: ${validationError}`,
    );
    return { status: 'error', result: null, error: validationError };
  }

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Initialize per-group memory database and build context
  try {
    const { getMemoryDb } = await import('./memory/db.js');
    const { buildMemoryContext, buildCrossChannelSummary } = await import('./memory/context-builder.js');
    getMemoryDb(groupDir);
    const context = buildMemoryContext(group.folder, input.prompt, groupDir);
    const crossChannel = buildCrossChannelSummary(group.folder);
    const parts = [context, crossChannel].filter(Boolean);
    const contextPath = path.join(groupDir, 'memory_context.md');
    if (parts.length > 0) {
      fs.writeFileSync(contextPath, parts.join('\n\n'));
    } else {
      try {
        fs.unlinkSync(contextPath);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to initialize memory for host agent');
  }

  // Set up per-group sessions directory (same as container runner)
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });

  // Sync skills
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }

  // Set up IPC directories
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });

  // Global memory directory
  const globalDir = path.join(GROUPS_DIR, 'global');

  // Build environment for the host agent runner
  const authMode = detectAuthMode();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    // Path configuration (host agent runner reads these)
    NANOCLAW_IPC_DIR: path.join(groupIpcDir, 'input'),
    NANOCLAW_WORK_DIR: groupDir,
    NANOCLAW_PROJECT_DIR: hostConfig.projectDir,
    NANOCLAW_GLOBAL_DIR: fs.existsSync(globalDir) ? globalDir : '',
    NANOCLAW_GROUPS_DIR: GROUPS_DIR,
    NANOCLAW_MEMORY_DB: path.join(groupDir, 'memory.db'),
    // Store sessions in per-group dir but let CLI find auth from default ~/.claude
    NANOCLAW_SESSIONS_DIR: groupSessionsDir,
    // Timezone
    TZ: TIMEZONE,
  };

  // Resolve Claude Code CLI path for the Agent SDK
  const claudeCodePath = resolveClaudeCodePath();
  if (claudeCodePath) {
    env.CLAUDE_CODE_PATH = claudeCodePath;
  }

  // Host mode uses real credentials directly (no proxy needed)
  // The credentials are already in process.env from .env file
  if (authMode === 'api-key') {
    // ANTHROPIC_API_KEY is already in process.env, passed through
  } else {
    // CLAUDE_CODE_OAUTH_TOKEN is already in process.env, passed through
  }

  // Resolve the host agent runner script
  const agentRunnerScript = path.join(
    process.cwd(),
    'dist',
    'host-agent-runner.js',
  );
  if (!fs.existsSync(agentRunnerScript)) {
    return {
      status: 'error',
      result: null,
      error: `Host agent runner not found at ${agentRunnerScript} — run npm run build`,
    };
  }

  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const processName = `nanoclaw-host-${safeName}-${Date.now()}`;

  logger.info(
    {
      group: group.name,
      processName,
      projectDir: hostConfig.projectDir,
      isMain: input.isMain,
    },
    'Spawning host agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [agentRunnerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: hostConfig.projectDir,
      env,
    });

    onProcess(proc, processName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    // Streaming output parsing (same as container runner)
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, processName },
        'Host agent timeout, sending SIGTERM',
      );
      proc.kill('SIGTERM');
      // Force kill after 15s if still alive
      setTimeout(() => {
        if (!proc.killed) {
          logger.warn(
            { group: group.name, processName },
            'Force killing host agent',
          );
          proc.kill('SIGKILL');
        }
      }, 15000);
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();

      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Host agent stdout truncated',
          );
        } else {
          stdout += chunk;
        }
      }

      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break;

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            resetTimeout();
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse host agent output chunk',
            );
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ host: group.folder }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, processName, duration, code },
            'Host agent timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({ status: 'success', result: null, newSessionId });
          });
          return;
        }

        resolve({
          status: 'error',
          result: null,
          error: `Host agent timed out after ${configTimeout}ms`,
        });
        return;
      }

      // Write log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `host-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Host Agent Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `ProjectDir: ${hostConfig.projectDir}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
      ];

      if (isVerbose || code !== 0) {
        logLines.push(
          '',
          `=== Stderr ===`,
          stderr,
          '',
          `=== Stdout ===`,
          stdout,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));

      if (code !== 0) {
        logger.error(
          { group: group.name, code, duration, logFile },
          'Host agent exited with error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Host agent exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Host agent completed (streaming mode)',
          );
          resolve({ status: 'success', result: null, newSessionId });
        });
        return;
      }

      // Legacy parse
      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);
        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }
        const output: ContainerOutput = JSON.parse(jsonLine);
        logger.info({ group: group.name, duration }, 'Host agent completed');
        resolve(output);
      } catch (err) {
        logger.error(
          { group: group.name, stdout, stderr, error: err },
          'Failed to parse host agent output',
        );
        resolve({
          status: 'error',
          result: null,
          error: 'Failed to parse output',
        });
      }
    });
  });
}
