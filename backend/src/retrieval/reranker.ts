/**
 * Deterministic, lightweight reranker. NO LLM, NO model, NO network.
 *
 * It reorders a bounded set of fused candidates using explainable, additive
 * lexical/metadata signals. It does NOT overwrite the raw vector/BM25/RRF
 * scores — it returns a separate `rerankScore` with a `scoreBreakdown`.
 *
 * Scoring formula (additive; each term contributes its weight when its
 * condition holds):
 *
 *   rerankScore(d) =
 *       W_RRF        * rrfScore(d)                       (carry base fusion signal)
 *     + W_SAT        * [satelliteId in query tokens]
 *     + W_SUB        * [subsystem token in query tokens]
 *     + W_ANOM       * [anomalyType token(s) in query tokens]
 *     + W_TITLE      * titleTermOverlapRatio(d)
 *     + W_CHUNK      * chunkTermOverlapRatio(d)
 *     + W_PHRASE     * [normalized query phrase is a substring of chunk]
 *     + W_AGREE      * [candidate present in BOTH vector and BM25 lists]
 *
 * All ratios are in [0,1]; all indicator terms are 0/1. Deterministic and
 * stable-tie-broken (rerankScore desc, then rrfScore desc, then document_id asc,
 * then chunk_index asc). The rerank score is a ranking signal — NOT a confidence.
 */
import type { FusionCandidate, RerankCandidate } from './types.js';
import type { RankContribution, ScoreBreakdown } from '../knowledge/types.js';
import { tokenize } from './tokenize.js';

export const RERANKER_VERSION = 'orion-deterministic-reranker-v1';

const W = {
  RRF: 1.0,
  SAT: 0.6,
  SUB: 0.4,
  ANOM: 0.4,
  TITLE: 0.5,
  CHUNK: 0.3,
  PHRASE: 0.5,
  AGREE: 0.3,
};

interface DocMeta {
  title: string;
  subsystem: string | null;
  satelliteId: string | null;
  anomalyType: string | null;
}

function parseMeta(metadataJson: string): DocMeta {
  try {
    const m = JSON.parse(metadataJson) as Partial<DocMeta>;
    return {
      title: typeof m.title === 'string' ? m.title : '',
      subsystem: m.subsystem ?? null,
      satelliteId: m.satelliteId ?? null,
      anomalyType: m.anomalyType ?? null,
    };
  } catch {
    return { title: '', subsystem: null, satelliteId: null, anomalyType: null };
  }
}

/** Split an identifier token (ORION-3, PAYLOAD_POWER) into its subtokens. */
function splitId(tok: string): string[] {
  return tok.split(/[-_]/).filter(Boolean);
}

/**
 * Expand a token list into a match set that includes each whole identifier
 * token AND its `-`/`_` subtokens. This lets `BATTERY_DEGRADATION` metadata
 * match a natural-language query ("battery degradation") while still allowing
 * exact identifier matches (ORION-3), consistent with the BM25 tokenizer.
 */
function expandSet(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) {
    s.add(t);
    for (const p of splitId(t)) s.add(p);
  }
  return s;
}

/** Overlap ratio = |query terms present in target set| / |unique query terms|. */
function overlapRatio(querySet: Set<string>, targetSet: Set<string>): number {
  if (querySet.size === 0) return 0;
  let hit = 0;
  for (const q of querySet) if (targetSet.has(q)) hit++;
  return hit / querySet.size;
}

/** Whether any token of `metaSet` appears in `querySet`. */
function anyShared(metaSet: Set<string>, querySet: Set<string>): boolean {
  for (const t of metaSet) if (querySet.has(t)) return true;
  return false;
}

function metaSet(value: string | null): Set<string> {
  if (!value) return new Set();
  return expandSet(tokenize(value, { maxTokens: 32, keepStopwords: true }));
}

export interface RerankOptions {
  maxTokens?: number;
}

/** Rerank fused candidates deterministically. Input should already be bounded. */
export function rerank(queryText: string, candidates: FusionCandidate[], opts: RerankOptions = {}): RerankCandidate[] {
  const queryTokens = tokenize(queryText, { maxTokens: opts.maxTokens ?? 64, keepStopwords: true });
  const querySet = expandSet(queryTokens);
  const normalizedQuery = queryText.normalize('NFC').toLowerCase().trim();

  const out: RerankCandidate[] = candidates.map((c) => {
    const meta = parseMeta(c.chunk.metadata_json);
    const contributions: RankContribution[] = [];
    let total = 0;

    const add = (cond: boolean | number, weight: number, signal: string, detail?: string) => {
      const factor = typeof cond === 'number' ? cond : cond ? 1 : 0;
      if (factor > 0) {
        const value = weight * factor;
        total += value;
        contributions.push({ signal, weight: Number(value.toFixed(6)), detail });
      }
    };

    // Base fusion signal carried forward (documented, not overwriting rrfScore).
    add(c.rrfScore, W.RRF, 'rrf_base', `rrfScore=${c.rrfScore.toFixed(6)}`);

    // Exact satellite ID match (the identifier token, e.g. "orion-3", is in the query).
    const satId = meta.satelliteId ? meta.satelliteId.normalize('NFC').toLowerCase() : null;
    add(!!satId && querySet.has(satId), W.SAT, 'satellite_match', meta.satelliteId ?? undefined);

    // Subsystem metadata match (any subsystem (sub)token appears in the query).
    add(anyShared(metaSet(meta.subsystem), querySet), W.SUB, 'subsystem_match', meta.subsystem ?? undefined);

    // Anomaly-type metadata match.
    add(anyShared(metaSet(meta.anomalyType), querySet), W.ANOM, 'anomaly_match', meta.anomalyType ?? undefined);

    // Title term overlap ratio.
    add(overlapRatio(querySet, expandSet(tokenize(meta.title, { maxTokens: 64, keepStopwords: true }))), W.TITLE, 'title_overlap');

    // Chunk term overlap ratio.
    add(overlapRatio(querySet, expandSet(tokenize(c.chunk.content, { maxTokens: 4096, keepStopwords: true }))), W.CHUNK, 'chunk_overlap');

    // Phrase match: whole normalized query is a substring of the chunk content.
    add(
      normalizedQuery.length >= 6 && c.chunk.content.normalize('NFC').toLowerCase().includes(normalizedQuery),
      W.PHRASE,
      'phrase_match',
    );

    // Retrieval agreement bonus (present in BOTH vector and BM25 lists).
    add(c.vectorRank !== null && c.bm25Rank !== null, W.AGREE, 'retrieval_agreement');

    const scoreBreakdown: ScoreBreakdown = { total: Number(total.toFixed(6)), contributions };
    return { ...c, rerankScore: scoreBreakdown.total, scoreBreakdown };
  });

  out.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    if (a.chunk.document_id !== b.chunk.document_id) return a.chunk.document_id - b.chunk.document_id;
    return a.chunk.chunk_index - b.chunk.chunk_index;
  });
  return out;
}
