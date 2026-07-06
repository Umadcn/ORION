/**
 * Phase 3 retrieval domain contracts (hybrid retrieval + evaluation).
 *
 * Builds on the Phase 2 knowledge contracts. Scores carried here (BM25, RRF,
 * rerank) are ranking signals only — NEVER an LLM confidence or RCA confidence.
 */
import type {
  KnowledgeChunk,
  RetrievalFilter,
  RetrievalMode,
  ScoreBreakdown,
} from '../knowledge/types.js';

export interface Bm25Query {
  terms: string[];
  filters: RetrievalFilter;
}

/** A chunk scored by BM25. */
export interface Bm25Candidate {
  chunk: KnowledgeChunk;
  score: number;
  rank: number; // 1-based
  matchedTerms: string[];
}

/** A chunk scored by vector cosine similarity. */
export interface VectorCandidate {
  chunk: KnowledgeChunk;
  similarity: number;
  rank: number; // 1-based
}

/** A candidate after Reciprocal Rank Fusion. */
export interface FusionCandidate {
  chunk: KnowledgeChunk;
  rrfScore: number;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  bm25Rank: number | null;
  bm25Score: number | null;
  matchedTerms: string[];
}

/** A fused candidate after deterministic reranking. */
export interface RerankCandidate extends FusionCandidate {
  rerankScore: number;
  scoreBreakdown: ScoreBreakdown;
}

/** A generic ranked candidate (union view used by diagnostics assembly). */
export interface RankedCandidate {
  chunk: KnowledgeChunk;
  finalRank: number;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  bm25Rank: number | null;
  bm25Score: number | null;
  rrfScore: number | null;
  rerankScore: number | null;
  matchedTerms: string[];
  scoreBreakdown: ScoreBreakdown | null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Graded relevance is optional; absence implies binary relevance = 1. */
export interface EvaluationJudgment {
  stableDocumentId: string;
  relevance?: number; // graded gain (>= 0); default 1 when relevant
}

export interface EvaluationQuery {
  queryId: string;
  query: string;
  filters?: RetrievalFilter;
  /** Relevant document stable IDs (canonicalized at load time). */
  relevantDocumentIds: string[];
  /** Optional graded judgments for nDCG. */
  judgments?: EvaluationJudgment[];
}

export interface EvaluationDataset {
  version: string;
  queries: EvaluationQuery[];
}

export interface EvaluationMetrics {
  k: number;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  hitRateAtK: number;
  ndcgAtK: number;
}

export interface PerQueryEvaluationResult {
  queryId: string;
  mode: RetrievalMode;
  returnedDocumentIds: string[];
  relevantDocumentIds: string[];
  metrics: EvaluationMetrics;
  latencyMs: number;
}

export interface EvaluationRun {
  correlationId: string;
  datasetVersion: string;
  mode: RetrievalMode;
  k: number;
  queryCount: number;
  metrics: EvaluationMetrics; // aggregate (macro-average across queries)
  perQuery: PerQueryEvaluationResult[];
  averageLatencyMs: number;
  configuration: Record<string, unknown>;
  status: 'SUCCESS' | 'FAILED';
  errorCode: string | null;
  sanitizedErrorMessage: string | null;
}

export interface EvaluationResult {
  runs: EvaluationRun[];
}

/** Persisted evaluation run row (mirrors retrieval_evaluation_runs). */
export interface EvaluationRunRecord {
  id: number;
  correlation_id: string;
  dataset_version: string;
  retrieval_mode: RetrievalMode;
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
  created_at: string;
}
