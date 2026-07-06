/**
 * Phase 2 Knowledge API tests: RBAC, auth, bounds, data-boundary safety.
 * Runs against the real Express app on an ephemeral port with an in-memory DB.
 * No network, no embedding API.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp, initOrion } from '../src/app.js';

let server: Server;
let base: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  // Log in once per role (login is rate-limited to 10/min/IP).
  for (const u of ['director', 'analyst', 'admin']) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: 'Orion@123' }),
    });
    tokens[u] = (await res.json()).access_token as string;
  }
});
afterAll(() => server?.close());

async function token(username: string) {
  return tokens[username];
}
const get = (path: string, tok?: string) =>
  fetch(`${base}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
const post = (path: string, body: unknown, tok?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });

describe('42/43. offline startup + status (LocalHashEmbedding fallback)', () => {
  it('serves knowledge status in LOCAL_HASH_FALLBACK mode with no secrets', async () => {
    const res = await get('/api/knowledge/status', await token('director'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operating_mode).toBe('LOCAL_HASH_FALLBACK');
    expect(body.embedding.embedding_operating_mode).toBe('LOCAL_HASH_FALLBACK');
    expect(body.document_count).toBeGreaterThan(0);
    const s = JSON.stringify(body);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toMatch(/api[_-]?key"?\s*[:=]\s*"?[A-Za-z0-9]{6}/i);
  });
  it('status is ops-only (analyst 403, unauth 401)', async () => {
    expect((await get('/api/knowledge/status')).status).toBe(401);
    expect((await get('/api/knowledge/status', await token('analyst'))).status).toBe(403);
  });
});

describe('40. seeded corpus idempotency', () => {
  it('re-running initOrion does not duplicate the corpus', async () => {
    initOrion();
    const res = await get('/api/knowledge/documents?limit=1', await token('analyst'));
    const body = await res.json();
    expect(body.total).toBe(8);
  });
});

describe('32. ingestion RBAC', () => {
  const doc = { stableDocumentId: 'API-DOC-1', title: 'API Doc', sourceType: 'OTHER', content: 'Bounded plain text content for ingestion.' };
  it('forbids analyst ingestion (403)', async () => {
    expect((await post('/api/knowledge/documents', doc, await token('analyst'))).status).toBe(403);
  });
  it('allows director ingestion (201) and reports READY', async () => {
    const res = await post('/api/knowledge/documents', doc, await token('director'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('READY');
    expect(body.citationIds.length).toBeGreaterThan(0);
  });
});

describe('33. search authentication + relevance', () => {
  it('requires authentication (401)', async () => {
    expect((await post('/api/knowledge/search', { query: 'power' })).status).toBe(401);
  });
  it('is available to analysts and returns labeled results', async () => {
    const res = await post('/api/knowledge/search', { query: 'communications transponder downlink loss', top_k: 3 }, await token('analyst'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embeddingMode).toBe('LOCAL_HASH_FALLBACK');
    expect(body.retrievalMode).toBe('VECTOR_COSINE');
    expect(body.similarityDisclaimer).toMatch(/not.*confidence/i);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.correlationId).toBeTruthy();
  });
});

describe('34. retrieval-debug RBAC', () => {
  it('forbids analyst (403), allows director (200)', async () => {
    expect((await get('/api/knowledge/retrieval-executions', await token('analyst'))).status).toBe(403);
    const res = await get('/api/knowledge/retrieval-executions?limit=5', await token('director'));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('items');
  });
});

describe('35/36/37. bounds + invalid metadata', () => {
  it('35. rejects an oversized query (400)', async () => {
    const res = await post('/api/knowledge/search', { query: 'x'.repeat(5000) }, await token('analyst'));
    expect(res.status).toBe(400);
  });
  it('36. rejects an oversized batch (400)', async () => {
    const documents = Array.from({ length: 26 }, (_, i) => ({ stableDocumentId: `B-${i}`, title: 't', sourceType: 'OTHER', content: 'text' }));
    const res = await post('/api/knowledge/documents/batch', { documents }, await token('director'));
    expect(res.status).toBe(400);
  });
  it('37. rejects an invalid metadata filter (400)', async () => {
    const res = await post('/api/knowledge/search', { query: 'power', filters: { sourceType: 'NONSENSE' } }, await token('analyst'));
    expect(res.status).toBe(400);
  });
});

describe('38/39. no filesystem-path / URL ingestion (sourceUri is an opaque label only)', () => {
  it('38. requires content — a path with no content is rejected (400)', async () => {
    const res = await post('/api/knowledge/documents', { stableDocumentId: 'PATH-DOC', title: 't', sourceType: 'OTHER', sourceUri: 'file:///etc/passwd' }, await token('director'));
    expect(res.status).toBe(400);
  });
  it('39. a URL sourceUri is stored as a label and never fetched; provided content is used verbatim', async () => {
    const content = 'This is the ONLY content that should be stored. No remote fetch occurs.';
    const res = await post(
      '/api/knowledge/documents',
      { stableDocumentId: 'URL-DOC', title: 'URL Doc', sourceType: 'OTHER', sourceUri: 'https://evil.example/should-not-be-fetched', content },
      await token('director'),
    );
    expect(res.status).toBe(201);
    const docRes = await get(`/api/knowledge/documents/${(await res.json()).documentId}`, await token('director'));
    const doc = await docRes.json();
    expect(doc.source_uri).toBe('https://evil.example/should-not-be-fetched');
    expect(doc.normalized_content).toContain('ONLY content that should be stored');
  });
});

describe('41. citation resolution over the API', () => {
  it('resolves a search citation to the exact chunk', async () => {
    const search = await post('/api/knowledge/search', { query: 'safe mode recovery staged payload reactivation', top_k: 1 }, await token('analyst'));
    const { items } = await search.json();
    const cid = items[0].citationId;
    const res = await get(`/api/knowledge/citations/${encodeURIComponent(cid)}`, await token('analyst'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunk.citation_id).toBe(cid);
    expect(body.citation.provenance.origin).toBe('SYNTHETIC_ORION_CORPUS');
  });
  it('rejects a malformed citation ID (400) and unknown citation (404)', async () => {
    expect((await get('/api/knowledge/citations/not-valid', await token('analyst'))).status).toBe(400);
    expect((await get('/api/knowledge/citations/ORION-KB-NOPE-C0000', await token('analyst'))).status).toBe(404);
  });
});
