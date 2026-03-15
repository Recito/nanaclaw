/**
 * Post-session digest — spawns a short agent session after each
 * substantive conversation to write a session digest to memory,
 * update STATE.md subjective fields, and optionally append to
 * PERSONA.md Self-Observations.
 *
 * Runs fire-and-forget. Failures are silently logged.
 */
import fs from 'fs';
import path from 'path';

import { runAgent as dispatchAgent } from './agent-dispatch.js';
import { ASSISTANT_NAME, GROUPS_DIR } from './config.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

const MIN_MESSAGES_FOR_DIGEST = 5;
const DIGEST_TIMEOUT_MS = 90_000; // 90 seconds max

function buildDigestPrompt(groupDir: string): string {
  const globalDir = path.join(GROUPS_DIR, 'global');
  const convDir = path.join(groupDir, 'conversations');
  const statePath = path.join(groupDir, 'STATE.md');
  const personaPath = path.join(globalDir, 'PERSONA.md');

  return `You just finished a conversation session. Your task is to create a brief session digest.

1. Read the latest conversation file in ${convDir}/ to review what happened.

2. Use remember() to store a session digest as an "event" memory with category "session-digest". Include:
   - Main topics discussed
   - Any decisions made
   - Emotional tone of the conversation
   - Anything notable or surprising

3. Update ${statePath} subjective fields (mood, energy, cognitive_load) based on how the session went.

4. If you noticed something about yourself worth recording (a tendency, strength, or growth area), append 1-2 lines to the Self-Observations section of ${personaPath}.

Keep it brief. This is background processing, not a conversation.

<internal>Session digest task — do not send any messages to the user.</internal>`;
}

export async function runPostSessionDigest(
  group: RegisteredGroup,
  chatJid: string,
  messageCount: number,
): Promise<void> {
  if (messageCount < MIN_MESSAGES_FOR_DIGEST) {
    logger.debug(
      { group: group.name, messageCount },
      'Skipping post-session digest: too few messages',
    );
    return;
  }

  const groupDir = resolveGroupFolderPath(group.folder);
  const convDir = path.join(groupDir, 'conversations');

  // Verify there's a recent conversation file to digest
  if (!fs.existsSync(convDir)) {
    logger.debug(
      { group: group.name },
      'Skipping post-session digest: no conversations directory',
    );
    return;
  }

  const files = fs.readdirSync(convDir).sort().reverse();
  if (files.length === 0) {
    return;
  }

  logger.info(
    { group: group.name, messageCount },
    'Running post-session digest',
  );

  try {
    await dispatchAgent(
      group,
      {
        prompt: buildDigestPrompt(groupDir),
        // No sessionId — fresh isolated session
        groupFolder: group.folder,
        chatJid,
        isMain: group.isMain === true,
        isScheduledTask: true, // Prevents session resume
        assistantName: ASSISTANT_NAME,
      },
      () => {
        // No process tracking needed for digest
      },
    );

    logger.info(
      { group: group.name },
      'Post-session digest completed',
    );
  } catch (err) {
    logger.debug(
      { err, group: group.name },
      'Post-session digest failed',
    );
  }
}
