/**
 * Grounded-generation audit repository (Phase 4). Follows the db-facade pattern.
 * Stores no prompts, no raw retrieved chunks, no raw model responses, no secrets,
 * no embeddings — only bounded outcome + diagnostics.
 */
import { db, now } from '../db.js';
import type { GenerationStatus, GenerationUseCase } from './types.js';
import type { LlmExecutionMode } from '../llm/types.js';

export interface GenerationExecutionRecord {
  id: number;
  correlation_id: string;
  investigation_id: number;
  use_case: GenerationUseCase;
  generation_status: GenerationStatus;
  llm_execution_id: number | null;
  provider_execution_mode: LlmExecutionMode | null;
  provider: string | null;
  model: string | null;
  prompt_version: string;
  retrieval_execution_id: number | null;
  retrieval_mode: string | null;
  context_source_count: number;
  included_evidence_count: number;
  included_citation_count: number;
  excluded_source_count: number;
  injection_flag_count: number;
  schema_valid: number | null;
  citation_valid: number | null;
  evidence_valid: number | null;
  grounding_valid: number | null;
  policy_valid: number | null;
  context_sufficient: number | null;
  claim_count: number;
  supported_claim_count: number;
  unsupported_claim_count: number;
  average_grounding_support: number | null;
  latency_ms: number;
  fallback_reason: string | null;
  rejection_reason: string | null;
  sanitized_error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreateGenerationExecution {
  correlation_id: string;
  investigation_id: number;
  use_case: GenerationUseCase;
  generation_status: GenerationStatus;
  llm_execution_id: number | null;
  provider_execution_mode: LlmExecutionMode | null;
  provider: string | null;
  model: string | null;
  prompt_version: string;
  retrieval_execution_id: number | null;
  retrieval_mode: string | null;
  context_source_count: number;
  included_evidence_count: number;
  included_citation_count: number;
  excluded_source_count: number;
  injection_flag_count: number;
  schema_valid: boolean | null;
  citation_valid: boolean | null;
  evidence_valid: boolean | null;
  grounding_valid: boolean | null;
  policy_valid: boolean | null;
  context_sufficient: boolean | null;
  claim_count: number;
  supported_claim_count: number;
  unsupported_claim_count: number;
  average_grounding_support: number | null;
  latency_ms: number;
  fallback_reason: string | null;
  rejection_reason: string | null;
  sanitized_error_message: string | null;
  created_by: string | null;
}

const b = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0);

export class GenerationExecutionRepository {
  create(rec: CreateGenerationExecution): number {
    const info = db
      .prepare(
        `INSERT INTO grounded_generation_executions
          (correlation_id, investigation_id, use_case, generation_status, llm_execution_id,
           provider_execution_mode, provider, model, prompt_version, retrieval_execution_id, retrieval_mode,
           context_source_count, included_evidence_count, included_citation_count, excluded_source_count,
           injection_flag_count, schema_valid, citation_valid, evidence_valid, grounding_valid, policy_valid,
           context_sufficient, claim_count, supported_claim_count, unsupported_claim_count,
           average_grounding_support, latency_ms, fallback_reason, rejection_reason, sanitized_error_message,
           created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.correlation_id, rec.investigation_id, rec.use_case, rec.generation_status, rec.llm_execution_id,
        rec.provider_execution_mode, rec.provider, rec.model, rec.prompt_version, rec.retrieval_execution_id,
        rec.retrieval_mode, rec.context_source_count, rec.included_evidence_count, rec.included_citation_count,
        rec.excluded_source_count, rec.injection_flag_count, b(rec.schema_valid), b(rec.citation_valid),
        b(rec.evidence_valid), b(rec.grounding_valid), b(rec.policy_valid), b(rec.context_sufficient),
        rec.claim_count, rec.supported_claim_count, rec.unsupported_claim_count, rec.average_grounding_support,
        rec.latency_ms, rec.fallback_reason, rec.rejection_reason, rec.sanitized_error_message, rec.created_by, now(),
      );
    return Number(info.lastInsertRowid);
  }

  getById(id: number): GenerationExecutionRecord | undefined {
    return db.prepare('SELECT * FROM grounded_generation_executions WHERE id = ?').get(id) as GenerationExecutionRecord | undefined;
  }

  list(filters: { investigationId?: number; status?: string; useCase?: string; limit?: number; offset?: number }): {
    total: number; limit: number; offset: number; items: GenerationExecutionRecord[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.investigationId !== undefined) { clauses.push('investigation_id = ?'); params.push(filters.investigationId); }
    if (filters.status) { clauses.push('generation_status = ?'); params.push(filters.status); }
    if (filters.useCase) { clauses.push('use_case = ?'); params.push(filters.useCase); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 50), 200));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM grounded_generation_executions ${where}`).get(...params) as { c: number }).c;
    const items = db
      .prepare(`SELECT * FROM grounded_generation_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as GenerationExecutionRecord[];
    return { total, limit, offset, items };
  }
}

export const generationRepo = new GenerationExecutionRepository();
