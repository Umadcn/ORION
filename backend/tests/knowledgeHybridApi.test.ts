/**
 * Phase 3 API tests: retrieval mode selection, evaluation endpoints, RBAC/auth,
 * bounds, and safety (no secrets, no score labeled confidence). Offline.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';

let server: Server;
let base: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  for (const u of ['director', 'analyst', 'admin']) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: 'Orion@123' }),
    });
    tokens[u] = (await res.json()).access_token as string;
  }
});
afterAll(() => server?.close());

const get = (path: string, u?: string) => fetch(`${base}${path}`, { headers: u ? { Authorization: `Bearer ${tokens[u]}` } : {} });
const post = (path: string, body: unknown, u?: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(body) });

describe('search mode selection', () => {
  it('60. backward compatible: omitted mode -> VECTOR_COSINE', async () => {
    const r = await post('/api/knowledge/search', { query: 'payload power', top_k: 3 }, 'analyst');
    const b = await r.json();
    expect(b.mode).toBe('VECTOR');
    expect(b.retrievalMode).toBe('VECTOR_COSINE');
    expect(b.embeddingMode).toBe('LOCAL_HASH_FALLBACK'); // 61
  });
  it('runs HYBRID_RRF and HYBRID_RRF_RERANK with diagnostics', async () => {
    const rrf = await (await post('/api/knowledge/search', { query: 'S-band communication downlink loss', mode: 'HYBRID_RRF', top_k: 3 }, 'analyst')).json();
    expect(rrf.retrievalMode).toBe('HYBRID_RRF');
    expect(rrf.items[0].rrfScore).not.toBeNull();
    expect(rrf.diagnostics.fusedCandidateCount).toBeGreaterThan(0);
    const rr = await (await post('/api/knowledge/search', { query: 'payload power latch-up on ORION-3', mode: 'HYBRID_RRF_RERANK', top_k: 3 }, 'analyst')).json();
    expect(rr.retrievalMode).toBe('HYBRID_RRF_RERANK');
    expect(rr.items[0].scoreBreakdown).not.toBeNull();
  });
  it('runs LEXICAL_BM25 without an embedding', async () => {
    const b = await (await post('/api/knowledge/search', { query: 'battery degradation voltage decay', mode: 'LEXICAL_BM25', top_k: 3 }, 'analyst')).json();
    expect(b.retrievalMode).toBe('LEXICAL_BM25');
    expect(b.diagnostics.embeddingUsed).toBe(false);
    expect(b.embeddingMode).toBeNull();
  });
  it('58. rejects an invalid retrieval mode (400)', async () => {
    expect((await post('/api/knowledge/search', { query: 'power', mode: 'MAGIC' }, 'analyst')).status).toBe(400);
  });
  it('62-65. no retrieval score is exposed as a confidence field; disclaimer present', async () => {
    const b = await (await post('/api/knowledge/search', { query: 'power', mode: 'HYBRID_RRF_RERANK', top_k: 3 }, 'analyst')).json();
    // No field/key named "confidence" anywhere (the disclaimer TEXT may mention the word).
    expect(JSON.stringify(b)).not.toMatch(/"[a-zA-Z_]*confidence[a-zA-Z_]*"\s*:/i);
    expect(b.similarityDisclaimer).toMatch(/not.*confidence/i);
    // 66: no secrets / raw vectors in the payload.
    expect(JSON.stringify(b)).not.toContain('embedding_json');
    expect(JSON.stringify(b)).not.toContain('Bearer ');
  });
});

describe('evaluation endpoints', () => {
  it('56/57. run is ops-only (analyst 403, unauth 401)', async () => {
    expect((await post('/api/knowledge/evaluations/run', { mode: 'VECTOR', k: 3 })).status).toBe(401);
    expect((await post('/api/knowledge/evaluations/run', { mode: 'VECTOR', k: 3 }, 'analyst')).status).toBe(403);
  });
  it('director runs a single mode and ALL modes with measured metrics', async () => {
    const single = await post('/api/knowledge/evaluations/run', { mode: 'HYBRID_RRF', k: 3 }, 'director');
    expect(single.status).toBe(201);
    const sb = await single.json();
    expect(sb.run.status).toBe('SUCCESS');
    expect(sb.run.metrics).toHaveProperty('precisionAtK');

    const all = await post('/api/knowledge/evaluations/run', { k: 3 }, 'admin'); // mode omitted -> ALL
    expect(all.status).toBe(201);
    const ab = await all.json();
    expect(ab.mode).toBe('ALL');
    expect(ab.runs.length).toBe(4);
  });
  it('59. rejects an invalid evaluation workload (400)', async () => {
    expect((await post('/api/knowledge/evaluations/run', { mode: 'VECTOR', k: -5 }, 'director')).status).toBe(400);
    expect((await post('/api/knowledge/evaluations/run', { mode: 'NOPE' }, 'director')).status).toBe(400);
  });
  it('lists + fetches evaluation runs (ops-only)', async () => {
    expect((await get('/api/knowledge/evaluations', 'analyst')).status).toBe(403);
    const list = await get('/api/knowledge/evaluations?limit=5', 'director');
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body).toHaveProperty('items');
    if (body.items.length) {
      const one = await get(`/api/knowledge/evaluations/${body.items[0].id}`, 'director');
      expect(one.status).toBe(200);
    }
    expect((await get('/api/knowledge/evaluations/99999', 'director')).status).toBe(404);
  });
});

describe('status exposes retrieval config', () => {
  it('includes modes + bounds + dataset version, no secrets', async () => {
    const b = await (await get('/api/knowledge/status', 'director')).json();
    expect(b.knowledge.default_mode).toBeDefined();
    expect(b.knowledge.fusion_k).toBeGreaterThan(0);
    expect(b.retrieval_modes).toContain('HYBRID_RRF');
    expect(b.evaluation_dataset_version).toBeTruthy();
    expect(JSON.stringify(b)).not.toContain('Bearer ');
  });
});
