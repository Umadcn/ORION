/**
 * Vector retrieval service.
 *
 * Flow: validate query -> normalize -> enforce size -> select embedding provider
 * -> embed query -> validate dimension -> apply metadata filters -> load bounded
 * candidates -> cosine similarity -> stable sort -> enforce topK -> attach stable
 * citations + provenance -> persist retrieval audit -> return normalized response.
 *
 * Similarity is a lexical/vector distance signal only. It is NOT an LLM
 * confidence and is NEVER converted into root-cause confidence.
 */
import crypto from 'node:crypto';
import { config, redactSecrets } from '../config.js';
import { resolveEmbeddingProvider } from '../embeddings/index.js';
import { assertFiniteVector, EmbeddingError, type EmbeddingProvider } from '../embeddings/provider.js';
import { deriveSpaceKey, spaceIdentityFromProvider } from '../providers/embeddingSpace.js';
import { effectiveActiveSpace } from '../providers/embeddingSpaceService.js';
import { normalizeContent } from './normalize.js';
import { KNOWLEDGE_CLASSIFICATIONS, KNOWLEDGE_SOURCE_TYPES, RETRIEVAL_MODES, retrievalModeToExecution } from './types.js';
import { documentRepo, retrievalAuditRepo } from './repository.js';
import { vectorStore } from './vectorStore.js';
import { tokenize } from '../retrieval/tokenize.js';
import { bm25Search } from '../retrieval/bm25.js';
import { reciprocalRankFusion } from '../retrieval/fusion.js';
import { rerank, RERANKER_VERSION } from '../retrieval/reranker.js';
import type { Bm25Candidate, RankedCandidate, VectorCandidate } from '../retrieval/types.js';
import type {
  Citation,
  KnowledgeChunk,
  KnowledgeChunkMetadata,
  KnowledgeDocument,
  RetrievalDiagnostics,
  RetrievalExecutionMode,
  RetrievalFilter,
  RetrievalMode,
  RetrievalQuery,
  RetrievalResult,
  RetrievalResultItem,
} from './types.js';

export const SIMILARITY_DISCLAIMER =
  'Cosine similarity is a lexical/vector relevance score for retrieval only. ' +
  'It is NOT an LLM confidence and is NOT root-cause confidence.';

/** Thrown for invalid retrieval input (maps to HTTP 400). */
export class RetrievalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalValidationError';
  }
}

/** Phase 9: thrown when the query embedding space does not match the active space (fail-closed → HTTP 409). */
export class RetrievalSpaceMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalSpaceMismatchError';
  }
}

/** Validate + whitelist metadata filters. Rejects invalid values. */
function validateFilters(raw: unknown): RetrievalFilter {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RetrievalValidationError('filters must be an object');
  }
  const f = raw as Record<string, unknown>;
  const out: RetrievalFilter = {};
  const strField = (key: string): string | undefined => {
    const v = f[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
      throw new RetrievalValidationError(`filter ${key} must be a non-empty string up to 200 chars`);
    }
    return v;
  };
  if (f.sourceType !== undefined && f.sourceType !== null) {
    const v = strField('sourceType')!;
    if (!KNOWLEDGE_SOURCE_TYPES.includes(v as never)) throw new RetrievalValidationError('filter sourceType is invalid');
    out.sourceType = v as never;
  }
  if (f.classification !== undefined && f.classification !== null) {
    const v = strField('classification')!;
    if (!KNOWLEDGE_CLASSIFICATIONS.includes(v as never)) throw new RetrievalValidationError('filter classification is invalid');
    out.classification = v as never;
  }
  const sub = strField('subsystem'); if (sub) out.subsystem = sub;
  const sat = strField('satelliteId'); if (sat) out.satelliteId = sat;
  const anom = strField('anomalyType'); if (anom) out.anomalyType = anom;
  return out;
}

function buildCitation(chunk: KnowledgeChunk, doc: KnowledgeDocument): Citation {
  let meta: Partial<KnowledgeChunkMetadata> = {};
  try { meta = JSON.parse(chunk.metadata_json) as KnowledgeChunkMetadata; } catch { /* fall back to doc */ }
  return {
    citationId: chunk.citation_id,
    documentId: doc.id,
    stableDocumentId: doc.stable_document_id,
    chunkIndex: chunk.chunk_index,
    title: meta.title ?? doc.title,
    sourceType: doc.source_type,
    documentVersion: doc.document_version,
    provenance: {
      origin: doc.provenance_origin,
      sourceUri: doc.source_uri,
      documentVersion: doc.document_version,
      ingestedBy: doc.created_by,
      ingestedAt: doc.created_at,
    },
  };
}

function validateMode(mode: unknown): RetrievalMode | null {
  if (mode === undefined || mode === null) return null;
  const m = String(mode).toUpperCase();
  if (!RETRIEVAL_MODES.includes(m as RetrievalMode)) {
    throw new RetrievalValidationError(`mode must be one of: ${RETRIEVAL_MODES.join(', ')}`);
  }
  return m as RetrievalMode;
}

function clampTopK(requested: number): number {
  return Math.max(1, Math.min(Math.floor(Number(requested) || config.retrieval.defaultTopK), config.retrieval.maxTopK));
}

/**
 * Execute a retrieval in the requested mode (VECTOR | LEXICAL_BM25 | HYBRID_RRF
 * | HYBRID_RRF_RERANK). Persists an audit record for every call. Backward
 * compatible: when `mode` is omitted it uses config.retrieval.defaultMode
 * (VECTOR), producing the exact Phase 2 response shape plus diagnostics.
 */
export async function retrieve(queryIn: RetrievalQuery): Promise<RetrievalResult> {
  const started = Date.now();
  const correlationId = queryIn.correlationId ?? crypto.randomUUID();

  // --- Validate + normalize query (throws -> HTTP 400, no audit written) ---
  if (typeof queryIn.query !== 'string' || queryIn.query.trim().length === 0) {
    throw new RetrievalValidationError('query is required and must be non-empty text');
  }
  if (queryIn.query.length > config.retrieval.maxQueryChars) {
    throw new RetrievalValidationError(`query exceeds max ${config.retrieval.maxQueryChars} characters`);
  }
  const normalizedQuery = normalizeContent(queryIn.query);
  if (normalizedQuery.length === 0) {
    throw new RetrievalValidationError('query has no searchable content after normalization');
  }
  const filters = validateFilters(queryIn.filters);
  const mode: RetrievalMode = validateMode(queryIn.mode) ?? (config.retrieval.defaultMode as RetrievalMode);

  const requestedTopKInt = Math.floor(Number(queryIn.topK ?? config.retrieval.defaultTopK) || config.retrieval.defaultTopK);
  const effectiveTopK = clampTopK(queryIn.topK ?? config.retrieval.defaultTopK);

  const queryHash = crypto.createHash('sha256').update(normalizedQuery, 'utf8').digest('hex');
  const querySummary = redactSecrets(normalizedQuery).slice(0, 200);
  const queryTokenCount = tokenize(normalizedQuery, { maxTokens: config.retrieval.maxQueryTokens }).length;

  const needEmbedding = mode !== 'LEXICAL_BM25';
  let provider: EmbeddingProvider | null = null;
  let querySpaceKey: string | null = null;
  let expectedSpaceKey: string | null = null;
  let spaceMismatchCount = 0;
  let vectorCandidates: VectorCandidate[] = [];
  let bm25Candidates: Bm25Candidate[] = [];
  let fusedCount = 0;
  let rerankedCount = 0;

  const auditFailure = (code: string, message: string) => {
    retrievalAuditRepo.create({
      correlation_id: correlationId, query_hash: queryHash, sanitized_query_summary: querySummary,
      retrieval_mode: 'FAILED' as RetrievalExecutionMode,
      embedding_provider: provider?.name ?? 'none', embedding_model: provider?.model ?? 'none',
      embedding_mode: needEmbedding ? 'FAILED' : 'NONE',
      requested_top_k: requestedTopKInt, effective_top_k: effectiveTopK,
      filters_json: Object.keys(filters).length ? JSON.stringify(filters) : null,
      candidate_count: 0, returned_count: 0, latency_ms: Date.now() - started, status: 'FAILED',
      error_code: code, sanitized_error_message: message, created_by: queryIn.createdBy ?? null,
      vector_candidate_count: 0, bm25_candidate_count: 0, fused_candidate_count: 0,
      reranked_candidate_count: 0, fusion_k: null, reranker_version: null,
      evaluation_run_id: queryIn.evaluationRunId ?? null,
    });
  };

  try {
    // --- Vector candidates (skipped for LEXICAL_BM25 -> no embedding generated) ---
    if (needEmbedding) {
      provider = resolveEmbeddingProvider().provider;
      // Phase 9: enforce embedding-space integrity. When a persisted ACTIVE space
      // exists, the query provider's space MUST match it; candidate vectors are
      // filtered to that space (fail-closed, never mix incomparable spaces).
      const active = effectiveActiveSpace();
      querySpaceKey = deriveSpaceKey(spaceIdentityFromProvider(provider, config.providers.embeddingNormalizationPolicy));
      if (active.persisted && querySpaceKey !== active.spaceKey) {
        auditFailure('EMBEDDING_SPACE_MISMATCH', `Query embedding space ${querySpaceKey} != active ${active.spaceKey}`);
        throw new RetrievalSpaceMismatchError(`Vector retrieval unavailable: query embedding space does not match the active space. Re-embed the corpus.`);
      }
      expectedSpaceKey = active.persisted ? active.spaceKey : null;
      const queryVector = await provider.embedText(normalizedQuery);
      assertFiniteVector(queryVector, provider.dimension());
      const vectorLimit = mode === 'VECTOR' ? effectiveTopK : config.retrieval.vectorCandidates;
      const { items, spaceMismatchCount: mm } = vectorStore.retrieve(queryVector, filters, vectorLimit, expectedSpaceKey);
      spaceMismatchCount = mm;
      vectorCandidates = items.map((s, i) => ({ chunk: s.chunk, similarity: s.similarity, rank: i + 1 }));
    }

    // --- BM25 candidates (skipped for pure VECTOR) ---
    if (mode !== 'VECTOR') {
      const bm25Limit = mode === 'LEXICAL_BM25' ? effectiveTopK : config.retrieval.bm25Candidates;
      bm25Candidates = bm25Search(normalizedQuery, filters, bm25Limit);
    }

    // --- Assemble ranked candidates per mode ---
    let ranked: RankedCandidate[] = [];
    if (mode === 'VECTOR') {
      ranked = vectorCandidates.slice(0, effectiveTopK).map((v, i) => ({
        chunk: v.chunk, finalRank: i + 1, vectorRank: v.rank, vectorSimilarity: v.similarity,
        bm25Rank: null, bm25Score: null, rrfScore: null, rerankScore: null, matchedTerms: [], scoreBreakdown: null,
      }));
    } else if (mode === 'LEXICAL_BM25') {
      ranked = bm25Candidates.slice(0, effectiveTopK).map((b, i) => ({
        chunk: b.chunk, finalRank: i + 1, vectorRank: null, vectorSimilarity: null,
        bm25Rank: b.rank, bm25Score: b.score, rrfScore: null, rerankScore: null, matchedTerms: b.matchedTerms, scoreBreakdown: null,
      }));
    } else {
      const fused = reciprocalRankFusion({ vector: vectorCandidates, bm25: bm25Candidates, k: config.retrieval.fusionK });
      fusedCount = fused.length;
      if (mode === 'HYBRID_RRF') {
        ranked = fused.slice(0, effectiveTopK).map((f, i) => ({
          chunk: f.chunk, finalRank: i + 1, vectorRank: f.vectorRank, vectorSimilarity: f.vectorSimilarity,
          bm25Rank: f.bm25Rank, bm25Score: f.bm25Score, rrfScore: f.rrfScore, rerankScore: null,
          matchedTerms: f.matchedTerms, scoreBreakdown: null,
        }));
      } else {
        const rerankSet = fused.slice(0, config.retrieval.rerankCandidates);
        const reranked = rerank(normalizedQuery, rerankSet, { maxTokens: config.retrieval.maxQueryTokens });
        rerankedCount = reranked.length;
        ranked = reranked.slice(0, effectiveTopK).map((r, i) => ({
          chunk: r.chunk, finalRank: i + 1, vectorRank: r.vectorRank, vectorSimilarity: r.vectorSimilarity,
          bm25Rank: r.bm25Rank, bm25Score: r.bm25Score, rrfScore: r.rrfScore, rerankScore: r.rerankScore,
          matchedTerms: r.matchedTerms, scoreBreakdown: r.scoreBreakdown,
        }));
      }
    }

    // --- Build items with citations + provenance (doc lookups cached) ---
    const docCache = new Map<number, KnowledgeDocument>();
    const items: RetrievalResultItem[] = [];
    for (const rc of ranked) {
      let doc = docCache.get(rc.chunk.document_id);
      if (!doc) {
        const found = documentRepo.getById(rc.chunk.document_id);
        if (!found) continue;
        doc = found;
        docCache.set(doc.id, doc);
      }
      const citation = buildCitation(rc.chunk, doc);
      const vsim = rc.vectorSimilarity !== null ? Number(rc.vectorSimilarity.toFixed(6)) : null;
      items.push({
        chunkId: rc.chunk.id, citationId: rc.chunk.citation_id, documentId: doc.id,
        stableDocumentId: doc.stable_document_id, title: citation.title, sourceType: doc.source_type,
        subsystem: doc.subsystem, satelliteId: doc.satellite_id, anomalyType: doc.anomaly_type,
        documentVersion: doc.document_version, content: rc.chunk.content,
        similarity: vsim,
        embeddingMode: needEmbedding && provider ? provider.mode : null,
        citation,
        finalRank: rc.finalRank,
        vectorRank: rc.vectorRank, vectorSimilarity: vsim,
        bm25Rank: rc.bm25Rank, bm25Score: rc.bm25Score !== null ? Number(rc.bm25Score.toFixed(6)) : null,
        rrfScore: rc.rrfScore !== null ? Number(rc.rrfScore.toFixed(8)) : null,
        rerankScore: rc.rerankScore !== null ? Number(rc.rerankScore.toFixed(6)) : null,
        matchedTerms: rc.matchedTerms.slice(0, 64),
        scoreBreakdown: rc.scoreBreakdown,
      });
    }

    const embeddingUsed = needEmbedding && provider !== null;
    const usesFusion = mode === 'HYBRID_RRF' || mode === 'HYBRID_RRF_RERANK';
    const candidateCount = Math.max(vectorCandidates.length, bm25Candidates.length, fusedCount);
    const latencyMs = Date.now() - started;

    const diagnostics: RetrievalDiagnostics = {
      mode, normalizedQuerySummary: querySummary, queryTokenCount,
      vectorCandidateCount: vectorCandidates.length, bm25CandidateCount: bm25Candidates.length,
      fusedCandidateCount: fusedCount, rerankedCandidateCount: rerankedCount, returnedCount: items.length,
      embeddingProvider: embeddingUsed ? provider!.name : null,
      embeddingModel: embeddingUsed ? provider!.model : null,
      embeddingMode: embeddingUsed ? provider!.mode : null,
      embeddingUsed,
      embeddingSpaceKey: embeddingUsed ? querySpaceKey : null,
      embeddingDimension: embeddingUsed && provider ? provider.dimension() : null,
      spaceMismatchCount,
      fusionK: usesFusion ? config.retrieval.fusionK : null,
      rerankerVersion: mode === 'HYBRID_RRF_RERANK' ? RERANKER_VERSION : null,
      filtersApplied: filters, latencyMs,
    };

    const executionMode = retrievalModeToExecution(mode);
    retrievalAuditRepo.create({
      correlation_id: correlationId, query_hash: queryHash, sanitized_query_summary: querySummary,
      retrieval_mode: executionMode,
      embedding_provider: embeddingUsed ? provider!.name : 'none',
      embedding_model: embeddingUsed ? provider!.model : 'none',
      embedding_mode: embeddingUsed ? provider!.mode : 'NONE',
      requested_top_k: requestedTopKInt, effective_top_k: effectiveTopK,
      filters_json: Object.keys(filters).length ? JSON.stringify(filters) : null,
      candidate_count: candidateCount, returned_count: items.length, latency_ms: latencyMs, status: 'SUCCESS',
      error_code: null, sanitized_error_message: null, created_by: queryIn.createdBy ?? null,
      vector_candidate_count: vectorCandidates.length, bm25_candidate_count: bm25Candidates.length,
      fused_candidate_count: fusedCount, reranked_candidate_count: rerankedCount,
      fusion_k: diagnostics.fusionK, reranker_version: diagnostics.rerankerVersion,
      evaluation_run_id: queryIn.evaluationRunId ?? null,
    });

    return {
      correlationId, mode, retrievalMode: executionMode,
      embeddingProvider: embeddingUsed ? provider!.name : null,
      embeddingModel: embeddingUsed ? provider!.model : null,
      embeddingMode: embeddingUsed ? provider!.mode : null,
      embeddingDimension: embeddingUsed ? provider!.dimension() : null,
      requestedTopK: requestedTopKInt, effectiveTopK, candidateCount,
      returnedCount: items.length, filters, items, diagnostics,
      similarityDisclaimer: SIMILARITY_DISCLAIMER,
    };
  } catch (err) {
    const code = err instanceof EmbeddingError ? err.code : 'RETRIEVAL_ERROR';
    const message = err instanceof Error ? redactSecrets(err.message).slice(0, 300) : 'Retrieval failed';
    auditFailure(code, message);
    throw err;
  }
}

/** Resolve a citation ID back to its exact chunk + citation metadata. */
export function resolveCitation(citationId: string): { chunk: KnowledgeChunk; citation: Citation; document: KnowledgeDocument } | null {
  const chunk = vectorStore.getByCitationId(citationId);
  if (!chunk) return null;
  const doc = documentRepo.getById(chunk.document_id);
  if (!doc) return null;
  return { chunk, citation: buildCitation(chunk, doc), document: doc };
}
