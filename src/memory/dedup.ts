/**
 * Content hashing for memory deduplication.
 * Same fact stored twice → reinforce, not duplicate.
 */
import { createHash } from 'crypto';

/**
 * Compute a content hash for deduplication.
 * Normalizes whitespace and case before hashing.
 * Returns first 16 hex characters of SHA-256.
 */
export function computeContentHash(
  summary: string,
  memoryType: string,
): string {
  const normalized = `${summary.trim().toLowerCase().replace(/\s+/g, ' ')}|${memoryType}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
