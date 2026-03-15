/**
 * Type definitions for the knowledge store.
 * Knowledge = generalized principles with confidence tracking.
 * Distinct from episodic memory (memory_items).
 */

export interface KnowledgeEntry {
  id: string;
  group_folder: string;
  domain: string;
  title: string;
  content: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  last_validated: string;
  derived_from: string[] | null;
  contradicted_by: string[] | null;
  is_global: boolean;
  status: 'active' | 'superseded' | 'refuted';
}

export interface CreateKnowledgeInput {
  group_folder: string;
  domain: string;
  title: string;
  content: string;
  confidence?: number;
  derived_from?: string[];
  is_global?: boolean;
}

export interface UpdateKnowledgeInput {
  confidence?: number;
  content?: string;
  contradicted_by?: string[];
  last_validated?: string;
  status?: 'active' | 'superseded' | 'refuted';
}

export interface KnowledgeSearchOptions {
  domain?: string;
  minConfidence?: number;
  limit?: number;
  includeGlobal?: boolean;
}
