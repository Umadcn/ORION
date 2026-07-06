/**
 * Phase 3 hybrid-retrieval unit + integration tests. Fully offline + deterministic.
 * Covers tokenizer, BM25, RRF, reranker, hybrid modes, diagnostics, and audit.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initSchema } from '../src/db.js';
import { tokenize, uniqueTokens } from '../src/retrieval/tokenize.js';
import { Bm25Index, bm25Search, resolveBm25Params } from '../src/retrieval/bm25.js';
import { reciprocalRankFusion } from '../src/retrieval/fusion.js';
import { rerank, RERANKER_VERSION } from '../src/retrieval/reranker.js';
import { retrieve } from '../src/knowledge/retrievalService.js';
import { ingestDocument } from '../src/knowledge/ingestionService.js';
import { seedKnowledgeIfEmpty } from '../src/knowledge/seed.js';
import { documentRepo, retrievalAuditRepo } from '../src/knowledge/repository.js';
import * as embeddings from '../src/embeddings/index.js';
import type { KnowledgeChunk } from '../src/knowledge/types.js';
import type { Bm25Candidate, VectorCandidate } from '../src/retrieval/types.js';

beforeAll(() => {
  initSchema();
  seedKnowledgeIfEmpty();
});

let CHUNK_SEQ = 1;
function mkChunk(docId: number, idx: number, content: string, meta: Record<string, unknown> = {}): KnowledgeChunk {
  const id = CHUNK_SEQ++;
  return {
    id, stable_chunk_id: `D${docId}#${idx}`, document_id: docId, chunk_index: idx,
    citation_id: `ORION-KB-D${docId}-C${String(idx).padStart(4, '0')}`, content,
    content_hash: 'h', start_offset: 0, end_offset: content.length, token_count_estimate: 1,
    metadata_json: JSON.stringify(meta), embedding_provider: 'local-hash', embedding_model: 'orion-localhash-v1',
    embedding_mode: 'LOCAL_HASH_FALLBACK', embedding_version: 'orion-localhash-v1', embedding_dimension: 256,
    embedding_json: '[]', created_at: '2026-01-01T00:00:00.000Z',
  };
}

// --------------------------------------------------------------------------
// Tokenizer (1-4)
// --------------------------------------------------------------------------
describe('tokenizer', () => {
  it('1. is deterministic', () => {
    expect(tokenize('ORION-3 payload power')).toEqual(tokenize('ORION-3 payload power'));
  });
  it('2. preserves mission identifiers', () => {
    const t = tokenize('ORION-3 PAYLOAD_POWER BATTERY-2 SAFE_MODE S-BAND', { keepStopwords: true });
    expect(t).toContain('orion-3');
    expect(t).toContain('payload_power');
    expect(t).toContain('battery-2');
    expect(t).toContain('safe_mode');
    expect(t).toContain('s-band');
  });
  it('3. preserves numeric values and units', () => {
    const t = tokenize('bus at 28V and 28.0 volts, -110 dBm', { keepStopwords: true });
    expect(t).toContain('28v');
    expect(t).toContain('28.0');
    expect(t).toContain('110'); // leading minus trimmed at edge, digits preserved
    expect(t).toContain('dbm');
  });
  it('4. bounds the token count', () => {
    expect(tokenize('a b c d e f g h', { maxTokens: 3, keepStopwords: true }).length).toBe(3);
    expect(uniqueTokens('power power power battery', { keepStopwords: true })).toEqual(['power', 'battery']);
  });
});

// --------------------------------------------------------------------------
// BM25 (5-16)
// --------------------------------------------------------------------------
describe('BM25', () => {
  const docs = [
    mkChunk(1, 0, 'battery degradation voltage decay on the power subsystem'),
    mkChunk(2, 0, 'thermal radiator heater overheating response'),
    mkChunk(3, 0, 'battery battery battery charging fault power'),
  ];

  it('5 + 7. ranks exact matches and is deterministic', () => {
    const idx = new Bm25Index(docs, resolveBm25Params());
    const r1 = idx.search(tokenize('battery power'), 10);
    const r2 = idx.search(tokenize('battery power'), 10);
    expect(r1.map((c) => c.chunk.id)).toEqual(r2.map((c) => c.chunk.id));
    // Doc 3 mentions battery x3 + power -> should rank at or above doc 1.
    expect(r1[0].chunk.document_id).toBe(3);
  });
  it('6. excludes zero-match chunks', () => {
    const idx = new Bm25Index(docs, resolveBm25Params());
    const r = idx.search(tokenize('thermal'), 10);
    expect(r.every((c) => c.matchedTerms.includes('thermal'))).toBe(true);
    expect(r.map((c) => c.chunk.document_id)).toEqual([2]);
  });
  it('8. stable tie-breaking by document/chunk order', () => {
    const tie = [mkChunk(5, 1, 'alpha bravo'), mkChunk(5, 0, 'alpha bravo'), mkChunk(4, 0, 'alpha bravo')];
    const idx = new Bm25Index(tie, resolveBm25Params());
    const r = idx.search(tokenize('alpha bravo'), 10);
    // Equal scores -> document_id asc, then chunk_index asc.
    expect(r.map((c) => `${c.chunk.document_id}:${c.chunk.chunk_index}`)).toEqual(['4:0', '5:0', '5:1']);
  });
  it('9 + 10. handles empty corpus and empty query', () => {
    expect(new Bm25Index([], resolveBm25Params()).search(tokenize('x'), 10)).toEqual([]);
    expect(new Bm25Index(docs, resolveBm25Params()).search([], 10)).toEqual([]);
  });
  it('11. produces only finite scores', () => {
    const idx = new Bm25Index(docs, resolveBm25Params());
    for (const c of idx.search(tokenize('battery power thermal'), 10)) expect(Number.isFinite(c.score)).toBe(true);
  });
  it('13. bounds candidate count', () => {
    const idx = new Bm25Index(docs, resolveBm25Params());
    expect(idx.search(tokenize('battery power thermal'), 1).length).toBe(1);
  });
  it('12 + 14 + 15 + 16. DB-backed filtering, index refresh, re-ingest, archive', async () => {
    // 14: new doc reflected immediately (index built per query from DB).
    await ingestDocument({ stableDocumentId: 'BM25-REFRESH', title: 'Refresh', sourceType: 'OTHER', subsystem: 'POWER', content: 'zzqq unique marker term about klystron amplifier' }, 'tester');
    let r = bm25Search('klystron amplifier', {}, 10);
    expect(r.some((c) => c.chunk.content.includes('klystron'))).toBe(true);
    // 12: metadata filter applied before scoring.
    const filtered = bm25Search('klystron amplifier', { subsystem: 'THERMAL' }, 10);
    expect(filtered.some((c) => c.chunk.content.includes('klystron'))).toBe(false);
    // 15: re-ingest with new term reflected; old term gone.
    await ingestDocument({ stableDocumentId: 'BM25-REFRESH', title: 'Refresh', sourceType: 'OTHER', subsystem: 'POWER', content: 'entirely different magnetron waveguide content now' }, 'tester');
    expect(bm25Search('klystron', {}, 10).some((c) => c.chunk.content.includes('klystron'))).toBe(false);
    expect(bm25Search('magnetron waveguide', {}, 10).some((c) => c.chunk.content.includes('magnetron'))).toBe(true);
    // 16: archived doc excluded.
    const doc = documentRepo.findByStableId('BM25-REFRESH')!;
    documentRepo.archive(doc.id);
    expect(bm25Search('magnetron', {}, 10).some((c) => c.chunk.document_id === doc.id)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// RRF (19-24)
// --------------------------------------------------------------------------
describe('Reciprocal Rank Fusion', () => {
  const A = mkChunk(10, 0, 'a');
  const B = mkChunk(11, 0, 'b');
  const C = mkChunk(12, 0, 'c');
  const vector: VectorCandidate[] = [
    { chunk: A, similarity: 0.9, rank: 1 },
    { chunk: B, similarity: 0.5, rank: 2 },
  ];
  const bm25: Bm25Candidate[] = [
    { chunk: B, score: 3.1, rank: 1, matchedTerms: ['b'] },
    { chunk: C, score: 1.2, rank: 2, matchedTerms: ['c'] },
  ];

  it('19 + 20 + 21. computes exact RRF scores for one-list and two-list candidates', () => {
    const fused = reciprocalRankFusion({ vector, bm25, k: 60 });
    const byId = new Map(fused.map((f) => [f.chunk.id, f]));
    expect(byId.get(A.id)!.rrfScore).toBeCloseTo(1 / 61, 10); // vector only
    expect(byId.get(C.id)!.rrfScore).toBeCloseTo(1 / 62, 10); // bm25 only
    expect(byId.get(B.id)!.rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10); // both lists
    expect(fused[0].chunk.id).toBe(B.id); // highest fused score
  });
  it('22. eliminates duplicates (one entry per chunk)', () => {
    const fused = reciprocalRankFusion({ vector, bm25, k: 60 });
    expect(fused.length).toBe(3);
    expect(new Set(fused.map((f) => f.chunk.id)).size).toBe(3);
  });
  it('23. stable tie-breaking by document/chunk order', () => {
    const v: VectorCandidate[] = [{ chunk: B, similarity: 0.5, rank: 1 }];
    const b: Bm25Candidate[] = [{ chunk: A, score: 1, rank: 1, matchedTerms: [] }];
    const fused = reciprocalRankFusion({ vector: v, bm25: b, k: 60 });
    // Equal rrf (both rank 1) -> document_id asc: A(10) before B(11).
    expect(fused.map((f) => f.chunk.document_id)).toEqual([10, 11]);
  });
  it('24. preserves per-source contributions', () => {
    const fused = reciprocalRankFusion({ vector, bm25, k: 60 });
    const b = fused.find((f) => f.chunk.id === B.id)!;
    expect(b.vectorRank).toBe(2);
    expect(b.bm25Rank).toBe(1);
    expect(b.bm25Score).toBe(3.1);
  });
});

// --------------------------------------------------------------------------
// Reranker (28-36)
// --------------------------------------------------------------------------
describe('deterministic reranker', () => {
  const fusion = (chunk: KnowledgeChunk, over: Partial<import('../src/retrieval/types.js').FusionCandidate> = {}) => ({
    chunk, rrfScore: 0.01, vectorRank: 1 as number | null, vectorSimilarity: 0.5 as number | null,
    bm25Rank: 1 as number | null, bm25Score: 2 as number | null, matchedTerms: [] as string[], ...over,
  });

  it('28. is deterministic', () => {
    const c = [fusion(mkChunk(20, 0, 'payload power converter', { title: 'Power', subsystem: 'POWER' }))];
    expect(rerank('payload power', c)).toEqual(rerank('payload power', c));
  });
  it('29. rewards exact satellite ID match', () => {
    const sat = fusion(mkChunk(21, 0, 'incident text', { title: 'Incident', satelliteId: 'ORION-3' }));
    const noSat = fusion(mkChunk(22, 0, 'incident text', { title: 'Incident' }), { rrfScore: 0.01 });
    const [top] = rerank('anomaly on orion-3', [noSat, sat]);
    expect(top.chunk.document_id).toBe(21);
    expect(top.scoreBreakdown.contributions.some((x) => x.signal === 'satellite_match')).toBe(true);
  });
  it('30 + 31. rewards subsystem and anomaly metadata matches', () => {
    const [r] = rerank('power battery degradation', [fusion(mkChunk(23, 0, 'text', { title: 'T', subsystem: 'POWER', anomalyType: 'BATTERY_DEGRADATION' }))]);
    const signals = r.scoreBreakdown.contributions.map((c) => c.signal);
    expect(signals).toContain('subsystem_match');
    expect(signals).toContain('anomaly_match');
  });
  it('32. rewards phrase match', () => {
    const [r] = rerank('safe mode recovery', [fusion(mkChunk(24, 0, 'follow the safe mode recovery steps', { title: 'T' }))]);
    expect(r.scoreBreakdown.contributions.some((c) => c.signal === 'phrase_match')).toBe(true);
  });
  it('33. rewards retrieval agreement (present in both lists)', () => {
    const both = fusion(mkChunk(25, 0, 'text', { title: 'T' }), { vectorRank: 1, bm25Rank: 1 });
    const one = fusion(mkChunk(26, 0, 'text', { title: 'T' }), { vectorRank: 1, bm25Rank: null, rrfScore: 0.01 });
    const [r] = rerank('unrelated', [one, both]);
    expect(r.chunk.document_id).toBe(25);
  });
  it('34 + 35 + 36. bounded, has score breakdown, preserves raw scores', () => {
    const c = fusion(mkChunk(27, 0, 'payload power', { title: 'Power', subsystem: 'POWER' }));
    const [r] = rerank('payload power', [c]);
    expect(typeof r.rerankScore).toBe('number');
    expect(r.scoreBreakdown.total).toBe(r.rerankScore);
    // Raw scores untouched.
    expect(r.rrfScore).toBe(0.01);
    expect(r.bm25Score).toBe(2);
    expect(r.vectorSimilarity).toBe(0.5);
  });
});

// --------------------------------------------------------------------------
// Hybrid service modes + diagnostics + audit (17,18,25,26,27,37,38,39,40,61)
// --------------------------------------------------------------------------
describe('hybrid retrieval service', () => {
  it('17. VECTOR mode is backward compatible', async () => {
    const r = await retrieve({ query: 'payload power', mode: 'VECTOR', topK: 3 });
    expect(r.mode).toBe('VECTOR');
    expect(r.retrievalMode).toBe('VECTOR_COSINE');
    expect(r.embeddingMode).toBe('LOCAL_HASH_FALLBACK');
    expect(r.items.every((i) => i.similarity !== null)).toBe(true);
  });
  it('18. LEXICAL_BM25 does not generate an embedding', async () => {
    const spy = vi.spyOn(embeddings, 'resolveEmbeddingProvider');
    const r = await retrieve({ query: 'battery degradation voltage', mode: 'LEXICAL_BM25', topK: 5 });
    expect(spy).not.toHaveBeenCalled();
    expect(r.diagnostics.embeddingUsed).toBe(false);
    expect(r.embeddingMode).toBeNull();
    expect(r.items.every((i) => i.bm25Score !== null)).toBe(true);
    spy.mockRestore();
  });
  it('25 + 26 + 27. HYBRID_RRF fuses, filters, ranks stably', async () => {
    const r = await retrieve({ query: 'S-band communication downlink loss', mode: 'HYBRID_RRF', topK: 5 });
    expect(r.retrievalMode).toBe('HYBRID_RRF');
    expect(r.items.every((i) => i.rrfScore !== null)).toBe(true);
    const again = await retrieve({ query: 'S-band communication downlink loss', mode: 'HYBRID_RRF', topK: 5 });
    expect(r.items.map((i) => i.citationId)).toEqual(again.items.map((i) => i.citationId));
    const filtered = await retrieve({ query: 'temperature', mode: 'HYBRID_RRF', filters: { subsystem: 'THERMAL' }, topK: 5 });
    expect(filtered.items.every((i) => i.subsystem === 'THERMAL')).toBe(true);
  });
  it('37 + 38. HYBRID_RRF_RERANK exposes bounded diagnostics + score breakdown', async () => {
    const r = await retrieve({ query: 'payload power converter latch-up on ORION-3', mode: 'HYBRID_RRF_RERANK', topK: 3 });
    expect(r.retrievalMode).toBe('HYBRID_RRF_RERANK');
    expect(r.diagnostics.rerankerVersion).toBe(RERANKER_VERSION);
    expect(r.diagnostics.fusionK).toBeGreaterThan(0);
    expect(r.items[0].rerankScore).not.toBeNull();
    expect(r.items[0].scoreBreakdown).not.toBeNull();
    expect(r.items.length).toBeLessThanOrEqual(3);
    // Diagnostics never leak secrets or raw vectors.
    const s = JSON.stringify(r.diagnostics);
    expect(s).not.toContain('embedding_json');
    expect(s).not.toContain('Bearer ');
  });
  it('39 + 40. audit persists expanded diagnostics; older-shape rows still readable', async () => {
    await retrieve({ query: 'attitude control reaction wheel saturation', mode: 'HYBRID_RRF_RERANK', topK: 3 });
    const latest = retrievalAuditRepo.list({ limit: 1 }).items[0];
    expect(latest.retrieval_mode).toBe('HYBRID_RRF_RERANK');
    expect(latest).toHaveProperty('fused_candidate_count');
    expect(latest).toHaveProperty('reranker_version');
    // A prior VECTOR-mode row remains readable with its own values.
    const list = retrievalAuditRepo.list({ mode: 'VECTOR_COSINE', limit: 1 });
    expect(list.total).toBeGreaterThan(0);
  });
});
