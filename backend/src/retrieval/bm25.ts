/**
 * Bounded, deterministic, in-process BM25 lexical retrieval over knowledge
 * chunks. No network, no external search engine.
 *
 * BM25 scoring (Lucene-style, non-negative IDF):
 *
 *   score(D, Q) = Σ_{t in Q}  IDF(t) * ( f(t,D) * (k1 + 1) )
 *                              / ( f(t,D) + k1 * (1 - b + b * |D| / avgdl) )
 *
 *   IDF(t) = ln( 1 + (N - n_t + 0.5) / (n_t + 0.5) )
 *
 * where f(t,D) is term frequency in chunk D, |D| is D's token count, avgdl is
 * the average chunk token count over the candidate corpus, N is the number of
 * chunks, and n_t is the number of chunks containing t. k1 and b are configurable.
 *
 * Index lifecycle: the index is built PER QUERY from a bounded candidate set
 * loaded from the current database (metadata filters applied before scoring).
 * There is intentionally NO persistent global index, so the results are always
 * consistent with the current corpus — newly ingested, re-ingested, or archived
 * documents are reflected immediately with no stale-index risk.
 */
import { config } from '../config.js';
import { chunkRepo } from '../knowledge/repository.js';
import type { KnowledgeChunk, RetrievalFilter } from '../knowledge/types.js';
import type { Bm25Candidate } from './types.js';
import { tokenize } from './tokenize.js';

export interface Bm25Params {
  k1: number;
  b: number;
}

interface IndexedDoc {
  chunk: KnowledgeChunk;
  termFreq: Map<string, number>;
  length: number;
}

/** A bounded BM25 index over a fixed set of chunks. Deterministic + offline. */
export class Bm25Index {
  private readonly docs: IndexedDoc[] = [];
  private readonly docFreq = new Map<string, number>();
  private readonly avgdl: number;
  private readonly n: number;

  constructor(chunks: KnowledgeChunk[], private readonly params: Bm25Params, maxTokensPerDoc = 100000) {
    let totalLen = 0;
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content, { maxTokens: maxTokensPerDoc });
      const termFreq = new Map<string, number>();
      for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      for (const t of termFreq.keys()) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      this.docs.push({ chunk, termFreq, length: tokens.length });
      totalLen += tokens.length;
    }
    this.n = this.docs.length;
    this.avgdl = this.n > 0 ? totalLen / this.n : 0;
  }

  get size(): number {
    return this.n;
  }

  private idf(term: string): number {
    const nt = this.docFreq.get(term) ?? 0;
    // Lucene-style smoothing keeps IDF strictly positive (>= ln(1) = 0).
    return Math.log(1 + (this.n - nt + 0.5) / (nt + 0.5));
  }

  /**
   * Score all chunks against the query terms. Chunks matching zero query terms
   * are excluded. Returns candidates ranked by score desc with deterministic
   * tie-breaking (document_id asc, then chunk_index asc). Bounded by `limit`.
   */
  search(queryTerms: string[], limit: number): Bm25Candidate[] {
    if (this.n === 0 || queryTerms.length === 0) return [];
    const { k1, b } = this.params;
    const uniqueTerms = Array.from(new Set(queryTerms));

    const scored: Bm25Candidate[] = [];
    for (const doc of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const term of uniqueTerms) {
        const f = doc.termFreq.get(term);
        if (!f) continue;
        matched.push(term);
        const idf = this.idf(term);
        const denom = f + k1 * (1 - b + (b * doc.length) / (this.avgdl || 1));
        const contrib = idf * ((f * (k1 + 1)) / (denom || 1));
        if (Number.isFinite(contrib)) score += contrib;
      }
      if (matched.length === 0) continue; // zero-match chunk excluded
      if (!Number.isFinite(score) || score <= 0) continue;
      scored.push({ chunk: doc.chunk, score, rank: 0, matchedTerms: matched });
    }

    scored.sort((a, b2) => {
      if (b2.score !== a.score) return b2.score - a.score;
      if (a.chunk.document_id !== b2.chunk.document_id) return a.chunk.document_id - b2.chunk.document_id;
      return a.chunk.chunk_index - b2.chunk.chunk_index;
    });

    const bounded = scored.slice(0, Math.max(1, Math.floor(limit)));
    bounded.forEach((c, i) => (c.rank = i + 1));
    return bounded;
  }
}

/** Resolve BM25 params from config, clamped to safe ranges. */
export function resolveBm25Params(): Bm25Params {
  const k1 = clampFloat(config.retrieval.bm25K1, 1.2, 0, 5);
  const b = clampFloat(config.retrieval.bm25B, 0.75, 0, 1);
  return { k1, b };
}

/**
 * Build a bounded BM25 index from the current DB candidate set (READY docs,
 * metadata filters applied) and run the query. Always fresh — no stale index.
 */
export function bm25Search(queryText: string, filters: RetrievalFilter, limit: number): Bm25Candidate[] {
  const chunks = chunkRepo.loadCandidates(
    {
      sourceType: filters.sourceType,
      subsystem: filters.subsystem,
      satelliteId: filters.satelliteId,
      anomalyType: filters.anomalyType,
      classification: filters.classification,
    },
    config.retrieval.maxCandidates,
  );
  const index = new Bm25Index(chunks, resolveBm25Params());
  const terms = tokenize(queryText, { maxTokens: config.retrieval.maxQueryTokens });
  return index.search(terms, limit);
}

function clampFloat(n: number, def: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
