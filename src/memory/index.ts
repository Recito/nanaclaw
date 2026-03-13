export { applySchema } from './schema.js';
export { buildMemoryContext } from './context-builder.js';
export { computeContentHash } from './dedup.js';
export { salienceScore, recencyDecay, reinforcementFactor } from './salience.js';
export { getMemoryDb, openMemoryDb, closeAllMemoryDbs } from './db.js';
export {
  createItem,
  reinforceItem,
  touchItem,
  getItemById,
  deleteItem,
  archiveItem,
  listItems,
  searchByKeyword,
  getTopSalient,
  findByContentHash,
  countItems,
  decayOldMemories,
} from './repository.js';
export type {
  MemoryType,
  MemoryItem,
  MemorySearchResult,
  CreateMemoryInput,
} from './types.js';
export { MEMORY_TYPES } from './types.js';
