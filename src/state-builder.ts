/**
 * Builds STATE.md for a group — mechanical stats from the host DB
 * plus preserved subjective fields written by the agent.
 */
import fs from 'fs';
import path from 'path';

import { getMessagesSince } from './db.js';
import { GROUPS_DIR } from './config.js';

interface SubjectiveFields {
  mood?: string;
  energy?: string;
  cognitive_load?: string;
}

/**
 * Parse subjective fields from an existing STATE.md file.
 * These are agent-written and should be preserved across rebuilds.
 */
function parseSubjectiveFields(statePath: string): SubjectiveFields {
  const fields: SubjectiveFields = {};
  if (!fs.existsSync(statePath)) return fields;

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const moodMatch = content.match(/^- mood:\s*(.+)$/m);
    const energyMatch = content.match(/^- energy:\s*(.+)$/m);
    const loadMatch = content.match(/^- cognitive_load:\s*(.+)$/m);
    if (moodMatch) fields.mood = moodMatch[1].trim();
    if (energyMatch) fields.energy = energyMatch[1].trim();
    if (loadMatch) fields.cognitive_load = loadMatch[1].trim();
  } catch {
    /* ignore parse errors */
  }
  return fields;
}

/**
 * Count today's conversations from the group's conversations/ directory.
 */
function countTodayConversations(groupDir: string): number {
  const convDir = path.join(groupDir, 'conversations');
  if (!fs.existsSync(convDir)) return 0;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    return fs.readdirSync(convDir).filter((f) => f.startsWith(today)).length;
  } catch {
    return 0;
  }
}

/**
 * Build STATE.md content for a group.
 */
export function buildStateFile(
  groupFolder: string,
  groupDir: string,
  chatJid: string,
): string {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Count today's messages from the host DB
  let messagesToday = 0;
  try {
    const msgs = getMessagesSince(chatJid, todayStart.toISOString(), '', 1000);
    messagesToday = msgs.length;
  } catch {
    /* DB not available */
  }

  const sessionsToday = countTodayConversations(groupDir);

  // Find last conversation file for "last rest" calculation
  let lastSessionEnded = 'unknown';
  const convDir = path.join(groupDir, 'conversations');
  if (fs.existsSync(convDir)) {
    try {
      const files = fs.readdirSync(convDir).sort().reverse();
      if (files.length > 0) {
        const stat = fs.statSync(path.join(convDir, files[0]));
        const hoursAgo = Math.round(
          (now.getTime() - stat.mtimeMs) / (1000 * 60 * 60),
        );
        lastSessionEnded = `${hoursAgo}h ago`;
      }
    } catch {
      /* ignore */
    }
  }

  // Preserve agent-written subjective fields
  const statePath = path.join(groupDir, 'STATE.md');
  const subjective = parseSubjectiveFields(statePath);

  return `# Agent State

## Current Session
- started: ${now.toISOString()}
- channel: ${groupFolder}

## Today
- sessions_today: ${sessionsToday}
- messages_today: ${messagesToday}
- last_session_ended: ${lastSessionEnded}

## Subjective (you update these)
- mood: ${subjective.mood || 'neutral'}
- energy: ${subjective.energy || 'normal'}
- cognitive_load: ${subjective.cognitive_load || 'light'}
`;
}
