/**
 * Mission Knowledge Base — domain contracts (Phase 2).
 *
 * These types describe the offline-first ingestion → chunking → embedding →
 * vector-retrieval pipeline. Two safety concepts are load-bearing:
 *   1. Embedding execution mode: LocalHashEmbedding output is ALWAYS labeled
 *      LOCAL_HASH_FALLBACK and is NEVER represented as REAL_EMBEDDING_PROVIDER.
 *   2. Retrieval similarity is a lexical/vector distance signal — it is NEVER
 *      an LLM confidence and is NEVER converted into root-cause confidence.
 */

/** Lifecycle of a knowledge document. */
export type KnowledgeDocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';

/** What kind of mission document this is. */
export type KnowledgeSourceType =
  | 'MISSION_MANUAL'
  | 'SUBSYSTEM_DOCUMENTATION'
  | 'ANOMALY_PROCEDURE'
  | 'INCIDENT_REPORT'
  | 'TROUBLESHOOTING_GUIDE'
  | 'MISSION_RULE'
  | 'OTHER';

/** Handling label. All Phase 2 content is unclassified synthetic demo data. */
export type KnowledgeClassification = 'UNCLASSIFIED' | 'INTERNAL' | 'RESTRICTED';

export const KNOWLEDGE_SOURCE_TYPES: KnowledgeSourceType[] = [
  'MISSION_MANUAL',
  'SUBSYSTEM_DOCUMENTATION',
  'ANOMALY_PROCEDURE',
  'INCIDENT_REPORT',
  'TROUBLESHOOTING_GUIDE',
  'MISSION_RULE',
  'OTHER',
];

export const KNOWLEDGE_CLASSIFICATIONS: KnowledgeClassification[] = ['UNCLASSIFIED', 'INTERNAL', 'RESTRICTED'];

/** Where a document/chunk came from — pure provenance labels, never fetched. */
export interface KnowledgeProvenance {
  /** e.g. SYNTHETIC_ORION_CORPUS | API_INGESTION. */
  origin: string;
  /** Opaque, human-readable source label (NEVER dereferenced/fetched). */
  sourceUri: string | null;
  documentVersion: string;
  ingestedBy: string | null;
  ingestedAt: string;
}

/** Caller-supplied ingestion input (plain text only — no paths, no URLs to fetch). */
export interface KnowledgeDocumentInput {
  stableDocumentId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  content: string;
  classification?: KnowledgeClassification;
  subsystem?: string | null;
  satelliteId?: string | null;
  anomalyType?: string | null;
  documentVersion?: string;
  /** Opaque provenance label only. It is stored, never fetched or resolved. */
  sourceUri?: string | null;
  /** Provenance origin; defaults to API_INGESTION. */
  provenanceOrigin?: string;
}

/** A stored knowledge document (row shape mirrors knowledge_documents). */
export interface KnowledgeDocument {
  id: number;
  stable_document_id: string;
  title: string;
  source_type: KnowledgeSourceType;
  classification: KnowledgeClassification;
  subsystem: string | null;
  satellite_id: string | null;
  anomaly_type: string | null;
  document_version: string;
  source_uri: string | null;
  provenance_origin: string;
  content_hash: string;
  normalized_content: string;
  char_count: number;
  chunk_count: number;
  status: KnowledgeDocumentStatus;
  failure_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface KnowledgeChunkMetadata {
  documentId: number;
  stableDocumentId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  classification: KnowledgeClassification;
  subsystem: string | null;
  satelliteId: string | null;
  anomalyType: string | null;
  documentVersion: string;
}

/** A stored chunk with its embedding (row shape mirrors knowledge_chunks). */
export interface KnowledgeChunk {
  id: number;
  stable_chunk_id: string;
  document_id: number;
  chunk_index: number;
  citation_id: string;
  content: string;
  content_hash: string;
  start_offset: number | null;
  end_offset: number | null;
  token_count_estimate: number | null;
  metadata_json: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_mode: EmbeddingExecutionMode;
  embedding_version: string;
  embedding_dimension: number;
  embedding_json: string;
  /** Phase 9: embedding-space key this vector belongs to (NULL for pre-Phase-9 rows). */
  embedding_space_key?: string | null;
  created_at: string;
}

/** Deterministic chunking parameters. */
export interface ChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSize: number;
}

/** One produced chunk before persistence. */
export interface ProducedChunk {
  chunkIndex: number;
  stableChunkId: string;
  citationId: string;
  content: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  tokenCountEstimate: number;
}

/** How an embedding vector was produced. */
export type EmbeddingExecutionMode = 'REAL_EMBEDDING_PROVIDER' | 'LOCAL_HASH_FALLBACK' | 'FAILED';

/**
 * How a retrieval was executed (stored in the audit trail + echoed as
 * `retrievalMode`). 'VECTOR_COSINE' is retained from Phase 2 for backward
 * compatibility (the VECTOR mode maps to it).
 */
export type RetrievalExecutionMode =
  | 'VECTOR_COSINE'
  | 'LEXICAL_BM25'
  | 'HYBRID_RRF'
  | 'HYBRID_RRF_RERANK'
  | 'FAILED';

/** High-level requested retrieval mode (Phase 3). */
export type RetrievalMode = 'VECTOR' | 'LEXICAL_BM25' | 'HYBRID_RRF' | 'HYBRID_RRF_RERANK';

export const RETRIEVAL_MODES: RetrievalMode[] = ['VECTOR', 'LEXICAL_BM25', 'HYBRID_RRF', 'HYBRID_RRF_RERANK'];

/** Map a high-level mode to the audited execution-mode descriptor. */
export function retrievalModeToExecution(mode: RetrievalMode): RetrievalExecutionMode {
  return mode === 'VECTOR' ? 'VECTOR_COSINE' : mode;
}

/** One weighted contribution to a deterministic rerank score. */
export interface RankContribution {
  signal: string;
  weight: number;
  detail?: string;
}

/** Explainable breakdown of a deterministic rerank score (NOT a confidence). */
export interface ScoreBreakdown {
  total: number;
  contributions: RankContribution[];
}

/** Bounded, secret-free retrieval diagnostics for explainability. */
export interface RetrievalDiagnostics {
  mode: RetrievalMode;
  normalizedQuerySummary: string;
  queryTokenCount: number;
  vectorCandidateCount: number;
  bm25CandidateCount: number;
  fusedCandidateCount: number;
  rerankedCandidateCount: number;
  returnedCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingMode: EmbeddingExecutionMode | null;
  embeddingUsed: boolean;
  /** Phase 9: sanitized active embedding-space key + per-query space integrity. */
  embeddingSpaceKey?: string | null;
  embeddingDimension?: number | null;
  spaceMismatchCount?: number;
  fusionK: number | null;
  rerankerVersion: string | null;
  filtersApplied: RetrievalFilter;
  latencyMs: number;
}

export interface IngestionRequest {
  documents: KnowledgeDocumentInput[];
}

export interface IngestionResult {
  stableDocumentId: string;
  documentId: number | null;
  status: KnowledgeDocumentStatus;
  chunkCount: number;
  contentHash: string | null;
  deduplicated: boolean;
  reIngested: boolean;
  citationIds: string[];
}

export interface IngestionFailure {
  stableDocumentId: string;
  status: 'FAILED';
  reason: string;
}

export type IngestionOutcome = IngestionResult | IngestionFailure;

/** A stable, resolvable citation back to an exact chunk. */
export interface Citation {
  citationId: string;
  documentId: number;
  stableDocumentId: string;
  chunkIndex: number;
  title: string;
  sourceType: KnowledgeSourceType;
  documentVersion: string;
  provenance: KnowledgeProvenance;
}

export interface CitationReference {
  citationId: string;
  stableDocumentId: string;
  chunkIndex: number;
}

export interface RetrievalFilter {
  sourceType?: KnowledgeSourceType;
  subsystem?: string;
  satelliteId?: string;
  anomalyType?: string;
  classification?: KnowledgeClassification;
}

export interface RetrievalQuery {
  query: string;
  topK?: number;
  filters?: RetrievalFilter;
  correlationId?: string;
  createdBy?: string | null;
  /** Phase 3: retrieval mode; defaults to config.retrieval.defaultMode. */
  mode?: RetrievalMode;
  /** Optional link to an evaluation run (for audited eval retrievals). */
  evaluationRunId?: number | null;
}

export interface RetrievalResultItem {
  chunkId: number;
  citationId: string;
  documentId: number;
  stableDocumentId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  subsystem: string | null;
  satelliteId: string | null;
  anomalyType: string | null;
  documentVersion: string;
  content: string;
  /**
   * Primary display score. For VECTOR mode this is cosine similarity in
   * [-1, 1]; null when the vector path did not participate (e.g. BM25-only).
   * NOT an LLM confidence and NOT an RCA confidence.
   */
  similarity: number | null;
  embeddingMode: EmbeddingExecutionMode | null;
  citation: Citation;

  // --- Phase 3 per-result diagnostics (all raw scores preserved separately) ---
  /** 1-based final rank in the returned list. */
  finalRank: number;
  /** 1-based rank in the vector candidate list (null if absent). */
  vectorRank: number | null;
  /** Cosine similarity from the vector path (null if absent). */
  vectorSimilarity: number | null;
  /** 1-based rank in the BM25 candidate list (null if absent). */
  bm25Rank: number | null;
  /** Raw BM25 score (null if absent). NOT a confidence. */
  bm25Score: number | null;
  /** Reciprocal Rank Fusion score (null if fusion not used). NOT a confidence. */
  rrfScore: number | null;
  /** Deterministic rerank score (null if rerank not used). NOT a confidence. */
  rerankScore: number | null;
  /** Query terms matched in this chunk (bounded). */
  matchedTerms: string[];
  /** Explainable rerank score breakdown (only when reranked). */
  scoreBreakdown: ScoreBreakdown | null;
}

export interface RetrievalResult {
  correlationId: string;
  /** High-level requested/executed mode (Phase 3). */
  mode: RetrievalMode;
  /** Audited execution descriptor; 'VECTOR_COSINE' for VECTOR (backward compat). */
  retrievalMode: RetrievalExecutionMode;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingMode: EmbeddingExecutionMode | null;
  embeddingDimension: number | null;
  requestedTopK: number;
  effectiveTopK: number;
  candidateCount: number;
  returnedCount: number;
  filters: RetrievalFilter;
  items: RetrievalResultItem[];
  diagnostics: RetrievalDiagnostics;
  /** Explicit reminder surfaced in the API payload. */
  similarityDisclaimer: string;
}

export interface RetrievalAuditRecord {
  id: number;
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
  created_at: string;
}
