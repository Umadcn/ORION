/**
 * Phase 2 Mission Knowledge Base unit + integration tests.
 * Fully offline + deterministic. No embedding API, no network.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../src/db.js';
import { normalizeContent, contentHash, normalizeAndHash } from '../src/knowledge/normalize.js';
import { chunkDocument, resolveChunkingConfig } from '../src/knowledge/chunk.js';
import { buildCitationId, parseCitationId, normalizeStableDocumentId, isValidCitationId } from '../src/knowledge/citations.js';
import { LocalHashEmbedding } from '../src/embeddings/localHashEmbedding.js';
import { HttpEmbeddingProvider } from '../src/embeddings/httpEmbeddingProvider.js';
import { cosineSimilarity, assertFiniteVector, l2Normalize } from '../src/embeddings/provider.js';
import { ingestDocument, ingestBatch } from '../src/knowledge/ingestionService.js';
import { retrieve, resolveCitation } from '../src/knowledge/retrievalService.js';
import { seedKnowledgeIfEmpty, SEED_CORPUS } from '../src/knowledge/seed.js';
import { documentRepo, chunkRepo, retrievalAuditRepo } from '../src/knowledge/repository.js';
import type { KnowledgeDocumentInput } from '../src/knowledge/types.js';

beforeAll(() => {
  initSchema();
  // Seed the corpus BEFORE any ad-hoc ingestion tests add extra documents, so
  // seedKnowledgeIfEmpty's empty-check reflects a clean corpus.
  seedKnowledgeIfEmpty();
});

const DOC = (over: Partial<KnowledgeDocumentInput> = {}): KnowledgeDocumentInput => ({
  stableDocumentId: 'TEST-DOC-1',
  title: 'Test Document',
  sourceType: 'MISSION_MANUAL',
  content: 'The ORION power bus operates at 28.0 volts. Battery stays above 55 percent.',
  ...over,
});

// --------------------------------------------------------------------------
// 1-3: Normalization + hashing
// --------------------------------------------------------------------------
describe('normalization + hashing', () => {
  it('1. is deterministic and unifies line endings/whitespace', () => {
    const a = normalizeContent('Line one\r\nLine   two\r\n\r\n\r\nLine three  ');
    const b = normalizeContent('Line one\nLine two\n\nLine three');
    expect(a).toBe(b);
    expect(normalizeContent(a)).toBe(a); // idempotent
  });

  it('2. produces stable hashes for identical logical content, distinct for different', () => {
    const h1 = normalizeAndHash('Battery at 74 percent\r\n').hash;
    const h2 = normalizeAndHash('Battery at 74 percent').hash;
    const h3 = normalizeAndHash('Battery at 75 percent').hash;
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('3. preserves mission-relevant numbers, units, and identifiers', () => {
    const n = normalizeContent('ORION-3 dropped to -110 dBm at 28.0 V, 74% SoC.');
    expect(n).toContain('ORION-3');
    expect(n).toContain('-110 dBm');
    expect(n).toContain('28.0 V');
    expect(n).toContain('74%');
  });
});

// --------------------------------------------------------------------------
// 4-9: Chunking + citations
// --------------------------------------------------------------------------
describe('deterministic chunking + citations', () => {
  const longText = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about the ORION power subsystem and battery ${i}.`).join('\n\n');

  it('4. is deterministic (same content + config -> same chunks)', () => {
    const cfg = { chunkSize: 300, chunkOverlap: 40, minChunkSize: 60 };
    const a = chunkDocument('DOC-A', normalizeContent(longText), cfg);
    const b = chunkDocument('DOC-A', normalizeContent(longText), cfg);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });

  it('5. produces bounded chunk sizes', () => {
    const cfg = { chunkSize: 300, chunkOverlap: 40, minChunkSize: 60 };
    const chunks = chunkDocument('DOC-A', normalizeContent(longText), cfg);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(300);
  });

  it('6. applies overlap (next chunk starts before previous chunk end)', () => {
    const cfg = { chunkSize: 300, chunkOverlap: 60, minChunkSize: 40 };
    const chunks = chunkDocument('DOC-A', normalizeContent(longText), cfg);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startOffset).toBeLessThan(chunks[i - 1].endOffset);
    }
  });

  it('7. never infinite-loops on pathological config (overlap >= size)', () => {
    const cfg = resolveChunkingConfig({ chunkSize: 50, chunkOverlap: 9999, minChunkSize: 1 });
    expect(cfg.chunkOverlap).toBeLessThan(cfg.chunkSize);
    const chunks = chunkDocument('DOC-B', 'a b c d '.repeat(500), cfg);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(5000);
  });

  it('8. produces stable chunk IDs', () => {
    const chunks = chunkDocument('DOC-C', normalizeContent(longText), { chunkSize: 300, chunkOverlap: 40, minChunkSize: 60 });
    expect(chunks[0].stableChunkId).toBe('DOC-C#0');
    expect(chunks[1].stableChunkId).toBe('DOC-C#1');
  });

  it('9. produces stable, parseable citation IDs', () => {
    expect(buildCitationId('ORION-POWER-OPS-MANUAL', 3)).toBe('ORION-KB-ORION-POWER-OPS-MANUAL-C0003');
    const parsed = parseCitationId('ORION-KB-ORION-POWER-OPS-MANUAL-C0003');
    expect(parsed).toEqual({ stableDocumentId: 'ORION-POWER-OPS-MANUAL', chunkIndex: 3 });
    expect(isValidCitationId('not-a-citation')).toBe(false);
    expect(normalizeStableDocumentId('orion power!!ops')).toBe('ORION-POWER-OPS');
  });
});

// --------------------------------------------------------------------------
// 10-13: Ingestion (dedup, idempotency, failure, transactional replace)
// --------------------------------------------------------------------------
describe('ingestion', () => {
  it('10 + 11. deduplicates identical content and is idempotent', async () => {
    const input = DOC({ stableDocumentId: 'DEDUP-DOC' });
    const first = await ingestDocument(input, 'tester');
    const second = await ingestDocument(input, 'tester');
    expect(first.status).toBe('READY');
    expect('deduplicated' in second && second.deduplicated).toBe(true);
    // Only one document row exists for this stable id.
    const found = documentRepo.findByStableId('DEDUP-DOC');
    expect(found?.chunk_count).toBe(first.status === 'READY' ? (first as any).chunkCount : 0);
  });

  it('12. reports FAILED for invalid documents in a batch (validation)', async () => {
    const outcomes = await ingestBatch(
      [DOC({ stableDocumentId: 'GOOD-1' }), { stableDocumentId: '', title: '', sourceType: 'MISSION_MANUAL', content: '' } as any],
      'tester',
    );
    expect(outcomes[0].status).toBe('READY');
    expect(outcomes[1].status).toBe('FAILED');
  });

  it('13. replaces chunks transactionally on controlled re-ingestion', async () => {
    const id = 'REINGEST-DOC';
    const short = await ingestDocument(DOC({ stableDocumentId: id, content: 'Short content about power.' }), 'tester');
    const docRow = documentRepo.findByStableId(id)!;
    const before = chunkRepo.listByDocument(docRow.id).total;
    const longContent = Array.from({ length: 30 }, (_, i) => `Extended paragraph ${i} about thermal control and radiators.`).join('\n\n');
    const re = await ingestDocument(DOC({ stableDocumentId: id, content: longContent }), 'tester');
    expect('reIngested' in re && re.reIngested).toBe(true);
    const after = chunkRepo.listByDocument(docRow.id).total;
    expect(after).toBeGreaterThan(before);
    // No orphan chunks: DB chunk count equals reported count.
    expect(after).toBe((re as any).chunkCount);
    expect(short.status).toBe('READY');
  });
});

// --------------------------------------------------------------------------
// 14-22: Embeddings + vector math
// --------------------------------------------------------------------------
describe('LocalHashEmbedding + vector math', () => {
  const emb = new LocalHashEmbedding(256);

  it('14. is deterministic', () => {
    expect(emb.embedTextSync('power subsystem fault')).toEqual(emb.embedTextSync('power subsystem fault'));
  });
  it('15. always reports LOCAL_HASH_FALLBACK', () => {
    expect(emb.mode).toBe('LOCAL_HASH_FALLBACK');
  });
  it('16. has a fixed dimension', () => {
    expect(emb.embedTextSync('anything').length).toBe(256);
    expect(emb.dimension()).toBe(256);
  });
  it('17. produces only finite values', () => {
    for (const v of emb.embedTextSync('ORION battery 74% -110 dBm')) expect(Number.isFinite(v)).toBe(true);
  });
  it('18. produces an L2-normalized vector for non-empty text', () => {
    const v = emb.embedTextSync('thermal radiator degradation');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
  it('19. batch size matches input length; HTTP provider rejects oversized batch', async () => {
    expect((await emb.embedBatch(['a', 'b', 'c'])).length).toBe(3);
    const http = new HttpEmbeddingProvider({ endpoint: 'http://x', apiKey: 'k', model: 'm', dimension: 4, maxBatchSize: 2, timeoutMs: 100, fetchImpl: (async () => new Response('{}')) as any });
    await expect(http.embedBatch(['a', 'b', 'c'])).rejects.toThrow(/BATCH_TOO_LARGE|exceeds/);
  });
  it('20. rejects dimension mismatch', () => {
    expect(() => assertFiniteVector([1, 2, 3], 4)).toThrow(/DIMENSION_MISMATCH|dimension/i);
  });
  it('21. rejects NaN/Infinity', () => {
    expect(() => assertFiniteVector([1, NaN, 3])).toThrow(/finite/i);
    expect(() => assertFiniteVector([1, Infinity])).toThrow(/finite/i);
  });
  it('22. cosine similarity is correct', () => {
    expect(cosineSimilarity(l2Normalize([1, 1, 0]), l2Normalize([1, 1, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0); // zero vector -> 0, no NaN
  });
});

// --------------------------------------------------------------------------
// 23-31: Retrieval, filters, citations, provenance, audit
// --------------------------------------------------------------------------
describe('retrieval + citations + audit (seeded corpus)', () => {
  it('seeds the full synthetic corpus and is idempotent', () => {
    for (const seed of SEED_CORPUS) {
      const canonical = normalizeStableDocumentId(seed.stableDocumentId);
      expect(documentRepo.findByStableId(canonical)?.status).toBe('READY');
    }
    const before = documentRepo.list({ limit: 1 }).total;
    seedKnowledgeIfEmpty(); // no-op since corpus already present
    expect(documentRepo.list({ limit: 1 }).total).toBe(before);
  });

  it('23. deterministic ranking (same query -> same ordering)', async () => {
    const q = { query: 'battery percent decline and elevated power consumption on the payload' };
    const r1 = await retrieve(q);
    const r2 = await retrieve(q);
    expect(r1.items.map((i) => i.citationId)).toEqual(r2.items.map((i) => i.citationId));
  });

  it('24. stable tie-breaking by document/chunk order for identical vectors', async () => {
    await ingestDocument(DOC({ stableDocumentId: 'TIE-A', content: 'identical tie content alpha bravo charlie' }), 'tester');
    await ingestDocument(DOC({ stableDocumentId: 'TIE-B', content: 'identical tie content alpha bravo charlie' }), 'tester');
    const r = await retrieve({ query: 'identical tie content alpha bravo charlie', topK: 25 });
    const a = r.items.find((i) => i.stableDocumentId === 'TIE-A');
    const b = r.items.find((i) => i.stableDocumentId === 'TIE-B');
    expect(a && b).toBeTruthy();
    // Same similarity -> lower document_id first (TIE-A ingested before TIE-B).
    expect(a!.similarity).toBeCloseTo(b!.similarity, 6);
    expect(a!.documentId).toBeLessThan(b!.documentId);
  });

  it('25. respects requested topK bound', async () => {
    const r = await retrieve({ query: 'power', topK: 3 });
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.effectiveTopK).toBe(3);
  });

  it('26. enforces the maximum topK', async () => {
    const r = await retrieve({ query: 'power', topK: 99999 });
    expect(r.effectiveTopK).toBeLessThanOrEqual(25);
    expect(r.items.length).toBeLessThanOrEqual(25);
  });

  it('27. applies metadata filters correctly', async () => {
    const r = await retrieve({ query: 'temperature radiator heater', filters: { subsystem: 'THERMAL' }, topK: 10 });
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) expect(i.subsystem).toBe('THERMAL');
  });

  it('28. resolves a citation back to the exact stored chunk', async () => {
    const r = await retrieve({ query: 'safe mode recovery steps', topK: 1 });
    const cid = r.items[0].citationId;
    const resolved = resolveCitation(cid);
    expect(resolved).not.toBeNull();
    expect(resolved!.chunk.citation_id).toBe(cid);
    expect(resolved!.chunk.content).toBe(r.items[0].content);
  });

  it('29. preserves provenance on seeded documents', async () => {
    const r = await retrieve({ query: 'reaction wheel saturation pointing error', topK: 1 });
    expect(r.items[0].citation.provenance.origin).toBe('SYNTHETIC_ORION_CORPUS');
  });

  it('30. persists a retrieval audit record for every call', async () => {
    const before = retrievalAuditRepo.list({ limit: 1 }).total;
    await retrieve({ query: 'communications transponder downlink' });
    const after = retrievalAuditRepo.list({ limit: 1 });
    expect(after.total).toBe(before + 1);
    expect(after.items[0].retrieval_mode).toBe('VECTOR_COSINE');
    expect(after.items[0].embedding_mode).toBe('LOCAL_HASH_FALLBACK');
  });

  it('31. sanitizes secrets in the audited query summary', async () => {
    await retrieve({ query: 'leak sk-ABCD1234EFGH5678 token in query' });
    const rec = retrievalAuditRepo.list({ limit: 1 }).items[0];
    expect(rec.sanitized_query_summary ?? '').not.toContain('sk-ABCD1234EFGH5678');
    expect(rec.sanitized_query_summary ?? '').toContain('REDACTED');
  });

  it('provenance + relevance: latch-up incident query surfaces the ORION-3 incident', async () => {
    const r = await retrieve({ query: 'payload power converter latch-up over-current isolated load switch', topK: 3 });
    expect(r.items[0].stableDocumentId).toBe('ORION-3-PAYLOAD-POWER-INCIDENT');
  });
});
