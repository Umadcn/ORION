/**
 * LLM execution audit repository. Follows the existing typed db-facade pattern.
 * Stores no secrets; raw payload summaries are only present when explicitly
 * opted-in and are sanitized/truncated by the runner before they arrive here.
 */
import { db, now } from '../db.js';
import type { LlmExecutionMode, LlmExecutionStatus } from '../llm/types.js';

export interface LlmExecutionRecord {
  id: number;
  correlation_id: string;
  investigation_id: number | null;
  agent_execution_id: number | null;
  provider: string;
  model: string;
  execution_mode: LlmExecutionMode;
  execution_status: LlmExecutionStatus;
  prompt_version: string;
  request_type: string;
  input_token_count: number | null;
  output_token_count: number | null;
  total_token_count: number | null;
  latency_ms: number;
  retry_count: number;
  structured_output_requested: number;
  structured_output_valid: number | null;
  validation_errors: string | null;
  fallback_reason: string | null;
  error_code: string | null;
  sanitized_error_message: string | null;
  request_summary: string | null;
  response_summary: string | null;
  created_at: string;
}

export interface CreateLlmExecution {
  correlation_id: string;
  investigation_id?: number | null;
  agent_execution_id?: number | null;
  provider: string;
  model: string;
  execution_mode: LlmExecutionMode;
  execution_status: LlmExecutionStatus;
  prompt_version: string;
  request_type: string;
  input_token_count?: number | null;
  output_token_count?: number | null;
  total_token_count?: number | null;
  latency_ms: number;
  retry_count: number;
  structured_output_requested: boolean;
  structured_output_valid?: boolean | null;
  validation_errors?: string[] | null;
  fallback_reason?: string | null;
  error_code?: string | null;
  sanitized_error_message?: string | null;
  request_summary?: string | null;
  response_summary?: string | null;
}

export function createLlmExecution(rec: CreateLlmExecution): number {
  const info = db
    .prepare(
      `INSERT INTO llm_executions
        (correlation_id, investigation_id, agent_execution_id, provider, model, execution_mode,
         execution_status, prompt_version, request_type, input_token_count, output_token_count,
         total_token_count, latency_ms, retry_count, structured_output_requested, structured_output_valid,
         validation_errors, fallback_reason, error_code, sanitized_error_message, request_summary,
         response_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id,
      rec.investigation_id ?? null,
      rec.agent_execution_id ?? null,
      rec.provider,
      rec.model,
      rec.execution_mode,
      rec.execution_status,
      rec.prompt_version,
      rec.request_type,
      rec.input_token_count ?? null,
      rec.output_token_count ?? null,
      rec.total_token_count ?? null,
      rec.latency_ms,
      rec.retry_count,
      rec.structured_output_requested ? 1 : 0,
      rec.structured_output_valid === null || rec.structured_output_valid === undefined ? null : rec.structured_output_valid ? 1 : 0,
      rec.validation_errors ? JSON.stringify(rec.validation_errors) : null,
      rec.fallback_reason ?? null,
      rec.error_code ?? null,
      rec.sanitized_error_message ?? null,
      rec.request_summary ?? null,
      rec.response_summary ?? null,
      now(),
    );
  return Number(info.lastInsertRowid);
}

export function getLlmExecution(id: number): LlmExecutionRecord | undefined {
  return db.prepare('SELECT * FROM llm_executions WHERE id = ?').get(id) as LlmExecutionRecord | undefined;
}

/** Most recent llm_executions row id for a correlation id (Phase 4 audit linking). */
export function getLlmExecutionIdByCorrelation(correlationId: string): number | null {
  const row = db
    .prepare('SELECT id FROM llm_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1')
    .get(correlationId) as { id: number } | undefined;
  return row ? row.id : null;
}

export interface ListFilters {
  provider?: string;
  model?: string;
  mode?: string;
  status?: string;
  investigationId?: number;
  since?: string; // ISO
  until?: string; // ISO
  limit?: number;
  offset?: number;
}

export interface ListResult {
  total: number;
  limit: number;
  offset: number;
  items: LlmExecutionRecord[];
}

export function listLlmExecutions(filters: ListFilters): ListResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.provider) { clauses.push('provider = ?'); params.push(filters.provider); }
  if (filters.model) { clauses.push('model = ?'); params.push(filters.model); }
  if (filters.mode) { clauses.push('execution_mode = ?'); params.push(filters.mode); }
  if (filters.status) { clauses.push('execution_status = ?'); params.push(filters.status); }
  if (filters.investigationId !== undefined) { clauses.push('investigation_id = ?'); params.push(filters.investigationId); }
  if (filters.since) { clauses.push('created_at >= ?'); params.push(filters.since); }
  if (filters.until) { clauses.push('created_at <= ?'); params.push(filters.until); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM llm_executions ${where}`).get(...params) as { c: number }).c;
  const items = db
    .prepare(`SELECT * FROM llm_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as LlmExecutionRecord[];
  return { total, limit, offset, items };
}
