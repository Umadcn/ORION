/**
 * Typed repositories for the Mission Knowledge Base, following the existing
 * db-facade pattern. All list/scan operations are bounded. No secrets are ever
 * stored or returned.
 */
import { db, now, transaction } from '../db.js';
import { config } from '../config.js';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  ProducedChunk,
  RetrievalAuditRecord,
  RetrievalExecutionMode,
  EmbeddingExecutionMode,
} from './types.js';
import type { EvaluationRunRecord } from '../retrieval/types.js';

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface CreateDocumentRow {
  stable_document_id: string;
  title: string;
  source_type: string;
  classification: string;
  subsystem: string | null;
  satellite_id: string | null;
  anomaly_type: string | null;
  document_version: string;
  source_uri: string | null;
  provenance_origin: string;
  content_hash: string;
  normalized_content: string;
  char_count: number;
  status: KnowledgeDocumentStatus;
  created_by: string | null;
}

export interface DocumentListFilters {
  sourceType?: string;
  subsystem?: string;
  satelliteId?: string;
  anomalyType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export class KnowledgeDocumentRepository {
  create(row: CreateDocumentRow): KnowledgeDocument {
    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO knowledge_documents
          (stable_document_id, title, source_type, classification, subsystem, satellite_id,
           anomaly_type, document_version, source_uri, provenance_origin, content_hash,
           normalized_content, char_count, chunk_count, status, failure_reason, created_by,
           created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, NULL)`,
      )
      .run(
        row.stable_document_id, row.title, row.source_type, row.classification, row.subsystem,
        row.satellite_id, row.anomaly_type, row.document_version, row.source_uri, row.provenance_origin,
        row.content_hash, row.normalized_content, row.char_count, row.status, row.created_by, ts, ts,
      );
    return this.getById(Number(info.lastInsertRowid))!;
  }

  /** Update mutable fields during controlled re-ingestion. */
  updateContent(id: number, fields: {
    title: string; source_type: string; classification: string; subsystem: string | null;
    satellite_id: string | null; anomaly_type: string | null; document_version: string;
    source_uri: string | null; provenance_origin: string; content_hash: string;
    normalized_content: string; char_count: number;
  }): void {
    db.prepare(
      `UPDATE knowledge_documents SET
         title = ?, source_type = ?, classification = ?, subsystem = ?, satellite_id = ?,
         anomaly_type = ?, document_version = ?, source_uri = ?, provenance_origin = ?,
         content_hash = ?, normalized_content = ?, char_count = ?, archived_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      fields.title, fields.source_type, fields.classification, fields.subsystem, fields.satellite_id,
      fields.anomaly_type, fields.document_version, fields.source_uri, fields.provenance_origin,
      fields.content_hash, fields.normalized_content, fields.char_count, now(), id,
    );
  }

  updateStatus(id: number, status: KnowledgeDocumentStatus, failureReason: string | null = null): void {
    db.prepare('UPDATE knowledge_documents SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, failureReason, now(), id);
  }

  setChunkCount(id: number, count: number): void {
    db.prepare('UPDATE knowledge_documents SET chunk_count = ?, updated_at = ? WHERE id = ?').run(count, now(), id);
  }

  archive(id: number): void {
    db.prepare('UPDATE knowledge_documents SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
      .run('ARCHIVED', now(), now(), id);
  }

  getById(id: number): KnowledgeDocument | undefined {
    return db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id) as KnowledgeDocument | undefined;
  }

  findByStableId(stableId: string): KnowledgeDocument | undefined {
    return db.prepare('SELECT * FROM knowledge_documents WHERE stable_document_id = ?').get(stableId) as
      | KnowledgeDocument
      | undefined;
  }

  findByContentHash(hash: string): KnowledgeDocument | undefined {
    return db.prepare('SELECT * FROM knowledge_documents WHERE content_hash = ? LIMIT 1').get(hash) as
      | KnowledgeDocument
      | undefined;
  }

  list(filters: DocumentListFilters): { total: number; limit: number; offset: number; items: KnowledgeDocument[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.sourceType) { clauses.push('source_type = ?'); params.push(filters.sourceType); }
    if (filters.subsystem) { clauses.push('subsystem = ?'); params.push(filters.subsystem); }
    if (filters.satelliteId) { clauses.push('satellite_id = ?'); params.push(filters.satelliteId); }
    if (filters.anomalyType) { clauses.push('anomaly_type = ?'); params.push(filters.anomalyType); }
    if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const limit = clamp(filters.limit ?? 50, 1, 200);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM knowledge_documents ${where}`).get(...params) as { c: number }).c;
    // Columns excluding the (potentially large) normalized_content for listings.
    const items = db
      .prepare(
        `SELECT id, stable_document_id, title, source_type, classification, subsystem, satellite_id,
                anomaly_type, document_version, source_uri, provenance_origin, content_hash,
                '' AS normalized_content, char_count, chunk_count, status, failure_reason, created_by,
                created_at, updated_at, archived_at
         FROM knowledge_documents ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as KnowledgeDocument[];
    return { total, limit, offset, items };
  }
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export interface ChunkEmbeddingInfo {
  provider: string;
  model: string;
  mode: EmbeddingExecutionMode;
  version: string;
  dimension: number;
}

/** A chunk candidate loaded for similarity scoring (vector parsed lazily). */
export interface ChunkCandidate extends KnowledgeChunk {
  vector: number[];
}

export class KnowledgeChunkRepository {
  /** Replace all chunks for a document atomically (safe re-ingestion). */
  replaceChunksForDocument(
    documentId: number,
    chunks: ProducedChunk[],
    vectors: number[][],
    embedding: ChunkEmbeddingInfo,
    metadataJson: string,
  ): void {
    transaction(() => {
      db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);
      const insert = db.prepare(
        `INSERT INTO knowledge_chunks
          (stable_chunk_id, document_id, chunk_index, citation_id, content, content_hash,
           start_offset, end_offset, token_count_estimate, metadata_json, embedding_provider,
           embedding_model, embedding_mode, embedding_version, embedding_dimension, embedding_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const ts = now();
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        insert.run(
          c.stableChunkId, documentId, c.chunkIndex, c.citationId, c.content, c.contentHash,
          c.startOffset, c.endOffset, c.tokenCountEstimate, metadataJson, embedding.provider,
          embedding.model, embedding.mode, embedding.version, embedding.dimension,
          JSON.stringify(vectors[i]), ts,
        );
      }
    });
  }

  deleteChunksForDocument(documentId: number): void {
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);
  }

  /** Phase 9: tag all chunks of a document with an embedding space key. */
  setSpaceKeyForDocument(documentId: number, spaceKey: string): void {
    db.prepare('UPDATE knowledge_chunks SET embedding_space_key = ? WHERE document_id = ?').run(spaceKey, documentId);
  }

  /** Phase 9: distinct embedding space keys currently present across chunks (derived when NULL). */
  distinctSpaceStats(): { space_key: string | null; embedding_provider: string; embedding_model: string; embedding_version: string; embedding_dimension: number; chunk_count: number }[] {
    return db.prepare(
      `SELECT embedding_space_key AS space_key, embedding_provider, embedding_model, embedding_version, embedding_dimension, COUNT(*) AS chunk_count
       FROM knowledge_chunks GROUP BY embedding_space_key, embedding_provider, embedding_model, embedding_version, embedding_dimension`,
    ).all() as { space_key: string | null; embedding_provider: string; embedding_model: string; embedding_version: string; embedding_dimension: number; chunk_count: number }[];
  }

  getByCitationId(citationId: string): KnowledgeChunk | undefined {
    return db.prepare('SELECT * FROM knowledge_chunks WHERE citation_id = ?').get(citationId) as
      | KnowledgeChunk
      | undefined;
  }

  listByDocument(documentId: number, limit = 200, offset = 0): { total: number; limit: number; offset: number; items: KnowledgeChunk[] } {
    const lim = clamp(limit, 1, 500);
    const off = Math.max(0, Math.floor(offset));
    const total = (db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks WHERE document_id = ?').get(documentId) as { c: number }).c;
    const items = db
      .prepare('SELECT * FROM knowledge_chunks WHERE document_id = ? ORDER BY chunk_index ASC LIMIT ? OFFSET ?')
      .all(documentId, lim, off) as KnowledgeChunk[];
    return { total, limit: lim, offset: off, items };
  }

  /**
   * Load bounded candidate chunks for vector similarity, applying metadata
   * filters via parameterized equality joins against the parent document.
   * Filters are whitelisted column equalities — no SQL injection surface.
   */
  loadCandidates(filters: {
    sourceType?: string; subsystem?: string; satelliteId?: string; anomalyType?: string; classification?: string;
  }, cap: number): ChunkCandidate[] {
    const clauses: string[] = ["d.status = 'READY'"];
    const params: unknown[] = [];
    if (filters.sourceType) { clauses.push('d.source_type = ?'); params.push(filters.sourceType); }
    if (filters.subsystem) { clauses.push('d.subsystem = ?'); params.push(filters.subsystem); }
    if (filters.satelliteId) { clauses.push('d.satellite_id = ?'); params.push(filters.satelliteId); }
    if (filters.anomalyType) { clauses.push('d.anomaly_type = ?'); params.push(filters.anomalyType); }
    if (filters.classification) { clauses.push('d.classification = ?'); params.push(filters.classification); }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const bounded = clamp(cap, 1, config.retrieval.maxCandidates);

    const rows = db
      .prepare(
        `SELECT c.* FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
         ${where}
         ORDER BY c.document_id ASC, c.chunk_index ASC
         LIMIT ?`,
      )
      .all(...params, bounded) as KnowledgeChunk[];

    const out: ChunkCandidate[] = [];
    for (const r of rows) {
      let vector: number[];
      try {
        vector = JSON.parse(r.embedding_json) as number[];
      } catch {
        continue; // skip corrupt row rather than fail the whole query
      }
      if (Array.isArray(vector)) out.push({ ...r, vector });
    }
    return out;
  }

  countAll(): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get() as { c: number }).c;
  }
}

// ---------------------------------------------------------------------------
// Retrieval audit
// ---------------------------------------------------------------------------

export interface CreateRetrievalAudit {
  correlation_id: string;
  query_hash: string;
  sanitized_query_summary: string | null;
  retrieval_mode: RetrievalExecutionMode;
  embedding_provider: string;
  embedding_model: string;
  embedding_mode: EmbeddingExecutionMode | 'NONE';
  requested_top_k: number;
  effective_top_k: number;
  filters_json: string | null;
  candidate_count: number;
  returned_count: number;
  latency_ms: number;
  status: 'SUCCESS' | 'FAILED';
  error_code: string | null;
  sanitized_error_message: string | null;
  created_by: string | null;
  // Phase 3 hybrid diagnostics (nullable):
  vector_candidate_count?: number | null;
  bm25_candidate_count?: number | null;
  fused_candidate_count?: number | null;
  reranked_candidate_count?: number | null;
  fusion_k?: number | null;
  reranker_version?: string | null;
  evaluation_run_id?: number | null;
}

export class RetrievalAuditRepository {
  create(rec: CreateRetrievalAudit): number {
    const info = db
      .prepare(
        `INSERT INTO retrieval_executions
          (correlation_id, query_hash, sanitized_query_summary, retrieval_mode, embedding_provider,
           embedding_model, embedding_mode, requested_top_k, effective_top_k, filters_json,
           candidate_count, returned_count, latency_ms, status, error_code, sanitized_error_message,
           created_by, created_at, vector_candidate_count, bm25_candidate_count, fused_candidate_count,
           reranked_candidate_count, fusion_k, reranker_version, evaluation_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.correlation_id, rec.query_hash, rec.sanitized_query_summary, rec.retrieval_mode,
        rec.embedding_provider, rec.embedding_model, rec.embedding_mode, rec.requested_top_k,
        rec.effective_top_k, rec.filters_json, rec.candidate_count, rec.returned_count,
        rec.latency_ms, rec.status, rec.error_code, rec.sanitized_error_message, rec.created_by, now(),
        rec.vector_candidate_count ?? null, rec.bm25_candidate_count ?? null, rec.fused_candidate_count ?? null,
        rec.reranked_candidate_count ?? null, rec.fusion_k ?? null, rec.reranker_version ?? null,
        rec.evaluation_run_id ?? null,
      );
    return Number(info.lastInsertRowid);
  }

  getById(id: number): RetrievalAuditRecord | undefined {
    return db.prepare('SELECT * FROM retrieval_executions WHERE id = ?').get(id) as RetrievalAuditRecord | undefined;
  }

  list(filters: { mode?: string; status?: string; limit?: number; offset?: number }): {
    total: number; limit: number; offset: number; items: RetrievalAuditRecord[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.mode) { clauses.push('retrieval_mode = ?'); params.push(filters.mode); }
    if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = clamp(filters.limit ?? 50, 1, 200);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM retrieval_executions ${where}`).get(...params) as { c: number }).c;
    const items = db
      .prepare(`SELECT * FROM retrieval_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as RetrievalAuditRecord[];
    return { total, limit, offset, items };
  }
}

// ---------------------------------------------------------------------------
// Retrieval evaluation runs (Phase 3)
// ---------------------------------------------------------------------------

export interface CreateEvaluationRun {
  correlation_id: string;
  dataset_version: string;
  retrieval_mode: string;
  configuration_json: string;
  query_count: number;
  k_value: number;
  precision_at_k: number;
  recall_at_k: number;
  mrr: number;
  hit_rate_at_k: number;
  ndcg_at_k: number | null;
  average_latency_ms: number;
  status: 'SUCCESS' | 'FAILED';
  error_code: string | null;
  sanitized_error_message: string | null;
  created_by: string | null;
}

export class RetrievalEvaluationRepository {
  create(rec: CreateEvaluationRun): number {
    const info = db
      .prepare(
        `INSERT INTO retrieval_evaluation_runs
          (correlation_id, dataset_version, retrieval_mode, configuration_json, query_count, k_value,
           precision_at_k, recall_at_k, mrr, hit_rate_at_k, ndcg_at_k, average_latency_ms, status,
           error_code, sanitized_error_message, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.correlation_id, rec.dataset_version, rec.retrieval_mode, rec.configuration_json, rec.query_count,
        rec.k_value, rec.precision_at_k, rec.recall_at_k, rec.mrr, rec.hit_rate_at_k, rec.ndcg_at_k,
        rec.average_latency_ms, rec.status, rec.error_code, rec.sanitized_error_message, rec.created_by, now(),
      );
    return Number(info.lastInsertRowid);
  }

  getById(id: number): EvaluationRunRecord | undefined {
    return db.prepare('SELECT * FROM retrieval_evaluation_runs WHERE id = ?').get(id) as EvaluationRunRecord | undefined;
  }

  list(filters: { mode?: string; limit?: number; offset?: number }): {
    total: number; limit: number; offset: number; items: EvaluationRunRecord[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.mode) { clauses.push('retrieval_mode = ?'); params.push(filters.mode); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = clamp(filters.limit ?? 50, 1, 200);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM retrieval_evaluation_runs ${where}`).get(...params) as { c: number }).c;
    const items = db
      .prepare(`SELECT * FROM retrieval_evaluation_runs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EvaluationRunRecord[];
    return { total, limit, offset, items };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export const documentRepo = new KnowledgeDocumentRepository();
export const chunkRepo = new KnowledgeChunkRepository();
export const retrievalAuditRepo = new RetrievalAuditRepository();
export const evaluationRepo = new RetrievalEvaluationRepository();
