/**
 * Memory system types for NanoClaw.
 */

export type MemoryType =
  | 'profile'
  | 'event'
  | 'knowledge'
  | 'behavior'
  | 'preference'
  | 'skill';

export const MEMORY_TYPES: readonly MemoryType[] = [
  'profile',
  'event',
  'knowledge',
  'behavior',
  'preference',
  'skill',
] as const;

export interface MemoryItem {
  id: string;
  group_folder: string;
  memory_type: MemoryType;
  summary: string;
  content_hash: string;
  access_count: number;
  last_accessed_at: string; // ISO 8601
  last_reinforced_at: string; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  category: string | null;
  is_global: boolean;
  status: 'active' | 'archived';
  embedding: Buffer | null;
  extra: Record<string, unknown> | null;
}

export interface MemorySearchResult {
  item: MemoryItem;
  salience: number;
}

export interface CreateMemoryInput {
  group_folder: string;
  memory_type: MemoryType;
  summary: string;
  category?: string;
  is_global?: boolean;
  extra?: Record<string, unknown>;
}
