/**
 * Reciprocal Rank Fusion (RRF).
 *
 *   RRF(d) = Σ_i  1 / (k + rank_i(d))
 *
 * where rank_i(d) is d's 1-based rank in retrieval list i (vector, BM25). A
 * document present in only one list contributes only that list's term. This is
 * RANK-based fusion — BM25 scores are never normalized against cosine
 * similarities. k is configurable (default 60). Deterministic with stable
 * tie-breaking (rrfScore desc, then document_id asc, then chunk_index asc).
 *
 * The fusion score is a ranking signal only — NOT a confidence.
 */
import type { Bm25Candidate, FusionCandidate, VectorCandidate } from './types.js';
import type { KnowledgeChunk } from '../knowledge/types.js';

export interface FusionInput {
  vector: VectorCandidate[];
  bm25: Bm25Candidate[];
  k: number;
}

/** Fuse vector + BM25 ranked lists via RRF. De-duplicates by chunk id. */
export function reciprocalRankFusion(input: FusionInput): FusionCandidate[] {
  const k = Math.max(1, Math.floor(input.k));
  const byId = new Map<number, FusionCandidate>();

  const ensure = (chunk: KnowledgeChunk): FusionCandidate => {
    let c = byId.get(chunk.id);
    if (!c) {
      c = {
        chunk,
        rrfScore: 0,
        vectorRank: null,
        vectorSimilarity: null,
        bm25Rank: null,
        bm25Score: null,
        matchedTerms: [],
      };
      byId.set(chunk.id, c);
    }
    return c;
  };

  for (const v of input.vector) {
    const c = ensure(v.chunk);
    c.vectorRank = v.rank;
    c.vectorSimilarity = v.similarity;
    c.rrfScore += 1 / (k + v.rank);
  }

  for (const b of input.bm25) {
    const c = ensure(b.chunk);
    c.bm25Rank = b.rank;
    c.bm25Score = b.score;
    // Union of matched terms (BM25 provides them).
    const set = new Set([...c.matchedTerms, ...b.matchedTerms]);
    c.matchedTerms = Array.from(set);
    c.rrfScore += 1 / (k + b.rank);
  }

  const fused = Array.from(byId.values());
  fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    if (a.chunk.document_id !== b.chunk.document_id) return a.chunk.document_id - b.chunk.document_id;
    return a.chunk.chunk_index - b.chunk.chunk_index;
  });
  return fused;
}
