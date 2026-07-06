/**
 * Append-only Phase 9 audit repositories. Parameterized SQL. Stores NO API keys,
 * Authorization headers, raw prompts, raw responses, raw embeddings, or hidden
 * reasoning — bounded metadata only.
 */
import { db, now } from '../db.js';
import type { ProviderKind, VerificationResult, VerificationType } from './types.js';

// --- Provider verification -------------------------------------------------

export interface CreateVerification {
  correlation_id: string;
  provider_kind: ProviderKind;
  provider_name: string;
  model: string | null;
  verification_type: VerificationType;
  status: string;
  live_provider_reached: boolean;
  latency_ms: number;
  structured_output_valid: boolean | null;
  embedding_dimension_valid: boolean | null;
  usage_metadata_available: boolean | null;
  normalized_error_code: string | null;
  sanitized_error_message: string | null;
  created_by: string | null;
}

export function createVerification(rec: CreateVerification): number {
  const info = db
    .prepare(
      `INSERT INTO provider_verification_executions
        (correlation_id, provider_kind, provider_name, model, verification_type, status, live_provider_reached,
         latency_ms, structured_output_valid, embedding_dimension_valid, usage_metadata_available,
         normalized_error_code, sanitized_error_message, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id, rec.provider_kind, rec.provider_name, rec.model, rec.verification_type, rec.status,
      rec.live_provider_reached ? 1 : 0, rec.latency_ms,
      boolInt(rec.structured_output_valid), boolInt(rec.embedding_dimension_valid), boolInt(rec.usage_metadata_available),
      rec.normalized_error_code, rec.sanitized_error_message, rec.created_by, now(),
    );
  return Number(info.lastInsertRowid);
}

export function latestVerification(kind: ProviderKind): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM provider_verification_executions WHERE provider_kind = ? ORDER BY id DESC LIMIT 1').get(kind) as Record<string, unknown> | undefined;
}

export function msSinceLastVerification(kind: ProviderKind, nowMs: number): number | null {
  const row = latestVerification(kind);
  if (!row) return null;
  const t = new Date(String(row.created_at)).getTime();
  return Number.isFinite(t) ? nowMs - t : null;
}

export function listVerifications(filters: { kind?: string; status?: string; limit?: number; offset?: number }) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.kind) { clauses.push('provider_kind = ?'); params.push(filters.kind); }
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 50), 200));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM provider_verification_executions ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(`SELECT * FROM provider_verification_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, limit, offset, items };
}

// --- Embedding spaces ------------------------------------------------------

const ACTIVE_SPACE_SETTING = 'active_embedding_space_key';

export interface UpsertSpace {
  space_key: string;
  provider: string;
  model: string;
  version: string;
  dimension: number;
  normalization_policy: string;
  status: string;
  document_count: number;
  chunk_count: number;
}

export function upsertEmbeddingSpace(rec: UpsertSpace): void {
  const existing = db.prepare('SELECT id FROM embedding_spaces WHERE space_key = ?').get(rec.space_key) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE embedding_spaces SET status = ?, document_count = ?, chunk_count = ? WHERE space_key = ?')
      .run(rec.status, rec.document_count, rec.chunk_count, rec.space_key);
  } else {
    db.prepare(
      `INSERT INTO embedding_spaces (space_key, provider, model, version, dimension, normalization_policy, status, document_count, chunk_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(rec.space_key, rec.provider, rec.model, rec.version, rec.dimension, rec.normalization_policy, rec.status, rec.document_count, rec.chunk_count, now());
  }
}

export function listEmbeddingSpaces(): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM embedding_spaces ORDER BY id DESC').all() as Record<string, unknown>[];
}

export function getEmbeddingSpace(spaceKey: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM embedding_spaces WHERE space_key = ?').get(spaceKey) as Record<string, unknown> | undefined;
}

export function getActiveSpaceKey(): string | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(ACTIVE_SPACE_SETTING) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Atomically mark a space ACTIVE + demote any previously-active space. */
export function activateEmbeddingSpace(spaceKey: string): void {
  const ts = now();
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE embedding_spaces SET status = 'INACTIVE' WHERE status = 'ACTIVE'").run();
    db.prepare("UPDATE embedding_spaces SET status = 'ACTIVE', activated_at = ? WHERE space_key = ?").run(ts, spaceKey);
    const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get(ACTIVE_SPACE_SETTING) as { key: string } | undefined;
    if (existing) db.prepare('UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?').run(spaceKey, ts, ACTIVE_SPACE_SETTING);
    else db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run(ACTIVE_SPACE_SETTING, spaceKey, ts);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- Re-index executions ---------------------------------------------------

export function createReindex(rec: { correlation_id: string; source_space_key: string | null; target_space_key: string; total_documents: number; total_chunks: number; created_by: string | null }): number {
  const info = db.prepare(
    `INSERT INTO embedding_reindex_executions
      (correlation_id, source_space_key, target_space_key, status, total_documents, processed_documents, total_chunks, processed_chunks, failed_documents, created_by, started_at)
     VALUES (?, ?, ?, 'RUNNING', ?, 0, ?, 0, 0, ?, ?)`,
  ).run(rec.correlation_id, rec.source_space_key, rec.target_space_key, rec.total_documents, rec.total_chunks, rec.created_by, now());
  return Number(info.lastInsertRowid);
}

export function updateReindex(id: number, patch: { status?: string; processed_documents?: number; processed_chunks?: number; failed_documents?: number; completed_at?: string | null; sanitized_error_message?: string | null }): void {
  const cur = db.prepare('SELECT * FROM embedding_reindex_executions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cur) return;
  db.prepare(
    `UPDATE embedding_reindex_executions SET status = ?, processed_documents = ?, processed_chunks = ?, failed_documents = ?, completed_at = ?, sanitized_error_message = ? WHERE id = ?`,
  ).run(
    patch.status ?? cur.status,
    patch.processed_documents ?? cur.processed_documents,
    patch.processed_chunks ?? cur.processed_chunks,
    patch.failed_documents ?? cur.failed_documents,
    patch.completed_at !== undefined ? patch.completed_at : (cur.completed_at ?? null),
    patch.sanitized_error_message !== undefined ? patch.sanitized_error_message : (cur.sanitized_error_message ?? null),
    id,
  );
}

export function getReindex(id: number): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM embedding_reindex_executions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

// --- Comparison runs -------------------------------------------------------

export function createComparisonRun(rec: { correlation_id: string; dataset_version: string; scenario_count: number; real_available: boolean; real_accepted_count: number; real_failed_count: number; fallback_count: number; real_grounding_valid_rate: number | null; fallback_grounding_valid_rate: number | null; real_avg_latency_ms: number | null; fallback_avg_latency_ms: number | null; status: string; created_by: string | null; sanitized_error_message: string | null }): number {
  const info = db.prepare(
    `INSERT INTO provider_comparison_runs
      (correlation_id, dataset_version, scenario_count, real_available, real_accepted_count, real_failed_count, fallback_count,
       real_grounding_valid_rate, fallback_grounding_valid_rate, real_avg_latency_ms, fallback_avg_latency_ms, status, created_by, created_at, sanitized_error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rec.correlation_id, rec.dataset_version, rec.scenario_count, rec.real_available ? 1 : 0, rec.real_accepted_count, rec.real_failed_count, rec.fallback_count,
    rec.real_grounding_valid_rate, rec.fallback_grounding_valid_rate, rec.real_avg_latency_ms, rec.fallback_avg_latency_ms, rec.status, rec.created_by, now(), rec.sanitized_error_message,
  );
  return Number(info.lastInsertRowid);
}

export function createComparisonResult(runId: number, rec: { scenario_key: string; arm: string; use_case: string; execution_mode: string; structured_output_valid: boolean | null; grounding_valid: boolean | null; citation_valid: boolean | null; evidence_valid: boolean | null; policy_valid: boolean | null; fallback_occurred: boolean; failed: boolean; average_grounding_support: number | null; latency_ms: number; input_tokens: number | null; output_tokens: number | null }): void {
  db.prepare(
    `INSERT INTO provider_comparison_results
      (comparison_run_id, scenario_key, arm, use_case, execution_mode, structured_output_valid, grounding_valid, citation_valid,
       evidence_valid, policy_valid, fallback_occurred, failed, average_grounding_support, latency_ms, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId, rec.scenario_key, rec.arm, rec.use_case, rec.execution_mode, boolInt(rec.structured_output_valid), boolInt(rec.grounding_valid),
    boolInt(rec.citation_valid), boolInt(rec.evidence_valid), boolInt(rec.policy_valid), rec.fallback_occurred ? 1 : 0, rec.failed ? 1 : 0,
    rec.average_grounding_support, rec.latency_ms, rec.input_tokens, rec.output_tokens, now(),
  );
}

export function getComparisonRun(id: number) {
  const run = db.prepare('SELECT * FROM provider_comparison_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!run) return undefined;
  const results = db.prepare('SELECT * FROM provider_comparison_results WHERE comparison_run_id = ? ORDER BY id').all(id);
  return { run, results };
}

export function listComparisonRuns(limit = 50, offset = 0) {
  const l = Math.max(1, Math.min(Math.floor(limit), 200));
  const o = Math.max(0, Math.floor(offset));
  const total = (db.prepare('SELECT COUNT(*) AS c FROM provider_comparison_runs').get() as { c: number }).c;
  const items = db.prepare('SELECT * FROM provider_comparison_runs ORDER BY id DESC LIMIT ? OFFSET ?').all(l, o);
  return { total, limit: l, offset: o, items };
}

function boolInt(v: boolean | null): number | null {
  return v === null ? null : v ? 1 : 0;
}

/** Verification-result → normalized response shape. */
export function toVerificationResult(id: number | null, r: CreateVerification, createdAt: string): VerificationResult {
  return {
    verificationId: id,
    correlationId: r.correlation_id,
    providerKind: r.provider_kind,
    providerName: r.provider_name,
    model: r.model,
    verificationType: r.verification_type,
    status: r.status as VerificationResult['status'],
    liveProviderReached: r.live_provider_reached,
    latencyMs: r.latency_ms,
    structuredOutputValid: r.structured_output_valid,
    embeddingDimensionValid: r.embedding_dimension_valid,
    usageMetadataAvailable: r.usage_metadata_available,
    normalizedErrorCode: r.normalized_error_code,
    sanitizedErrorMessage: r.sanitized_error_message,
    createdAt,
  };
}
