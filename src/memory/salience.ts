/**
 * Salience scoring for memory retrieval.
 *
 * score = similarity × log(access_count + 1) × recency_decay
 *
 * Inspired by MemU's salience-aware ranking.
 */

/** Half-life in days for recency decay. */
const HALF_LIFE_DAYS = 30;
const DECAY_CONSTANT = Math.LN2 / HALF_LIFE_DAYS;

/**
 * Compute recency decay factor (0..1].
 * After HALF_LIFE_DAYS without access, factor ≈ 0.5.
 */
export function recencyDecay(lastAccessedAt: string | Date): number {
  const lastAccessed =
    lastAccessedAt instanceof Date
      ? lastAccessedAt
      : new Date(lastAccessedAt);
  const daysAgo =
    (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo <= 0) return 1.0;
  return Math.exp(-DECAY_CONSTANT * daysAgo);
}

/**
 * Compute reinforcement factor.
 * Logarithmic scaling prevents frequently-accessed memories
 * from dominating results.
 */
export function reinforcementFactor(accessCount: number): number {
  return Math.log(Math.max(accessCount, 1) + 1);
}

/**
 * Compute the full salience score for a memory item.
 *
 * @param similarity - Cosine similarity or FTS5 rank (0..1)
 * @param accessCount - Number of times this memory was accessed
 * @param lastAccessedAt - ISO timestamp of last access
 */
export function salienceScore(
  similarity: number,
  accessCount: number,
  lastAccessedAt: string | Date,
): number {
  return (
    similarity *
    reinforcementFactor(accessCount) *
    recencyDecay(lastAccessedAt)
  );
}
