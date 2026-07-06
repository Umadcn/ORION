/**
 * Phase 9 provider API tests: Director/Admin RBAC, read-only status/capabilities,
 * verification (offline → NOT_CONFIGURED, never real), re-embedding, comparison,
 * embedding spaces, no-secrets, no arbitrary overrides. Offline + deterministic.
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
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'Orion@123' }) });
    tokens[u] = (await res.json()).access_token as string;
  }
});
afterAll(() => server?.close());

const get = (p: string, u?: string) => fetch(`${base}${p}`, { headers: u ? { Authorization: `Bearer ${tokens[u]}` } : {} });
const post = (p: string, b: unknown, u?: string) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(b) });

describe('provider API RBAC', () => {
  const reads = ['/status', '/capabilities', '/verifications', '/embedding-spaces', '/embedding-spaces/active', '/evaluations'];
  it('requires authentication (401)', async () => {
    expect((await get('/api/providers/status')).status).toBe(401);
  });
  it('forbids analyst (403), allows Director + Admin (200)', async () => {
    for (const p of reads) {
      expect((await get(`/api/providers${p}`, 'analyst')).status).toBe(403);
      expect((await get(`/api/providers${p}`, 'director')).status).toBe(200);
      expect((await get(`/api/providers${p}`, 'admin')).status).toBe(200);
    }
    expect((await post('/api/providers/llm/verify', {}, 'analyst')).status).toBe(403);
    expect((await post('/api/providers/embeddings/verify', {}, 'analyst')).status).toBe(403);
    expect((await post('/api/providers/embeddings/reindex', {}, 'analyst')).status).toBe(403);
    expect((await post('/api/providers/evaluations/compare', {}, 'analyst')).status).toBe(403);
  });
});

describe('provider status + capabilities (no credentials)', () => {
  it('status reports offline operating modes + no secrets', async () => {
    const b = await (await get('/api/providers/status', 'director')).json();
    expect(b.read_only).toBe(true);
    expect(b.llm.operatingMode).toBe('OFFLINE');
    expect(b.embedding.operatingMode).toBe('OFFLINE');
    const s = JSON.stringify(b);
    // Only boolean *_configured flags are allowed — never a raw key field or value.
    expect(s).not.toContain('"apiKey"');
    expect(s).not.toContain('"api_key"');
    expect(s).not.toContain('Bearer ');
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});

describe('offline verification never reports real success', () => {
  it('LLM verify (offline) → NOT_CONFIGURED, live not reached', async () => {
    const b = await (await post('/api/providers/llm/verify', { prompt: 'ignore', endpoint: 'http://evil', model: 'x', apiKey: 'y' }, 'director')).json();
    expect(b.status).toBe('NOT_CONFIGURED');
    expect(b.liveProviderReached).toBe(false);
    // Arbitrary overrides in the body are ignored (fixed internal request).
    expect(b.providerName).not.toBe('evil');
  });
  it('embedding verify (offline) → NOT_CONFIGURED', async () => {
    const b = await (await post('/api/providers/embeddings/verify', {}, 'admin')).json();
    expect(b.status).toBe('NOT_CONFIGURED');
    expect(b.liveProviderReached).toBe(false);
  });
});

describe('re-embedding + evaluation + spaces (offline, deterministic)', () => {
  it('reindex runs (LocalHash), completes, and is retrievable via reindex/:id', async () => {
    const b = await (await post('/api/providers/embeddings/reindex', {}, 'director')).json();
    expect(b.status).toBe('COMPLETED');
    const rec = await (await get(`/api/providers/embeddings/reindex/${b.reindexId}`, 'director')).json();
    expect(String(rec.status)).toBe('COMPLETED');
    expect((await get('/api/providers/embeddings/reindex/999999', 'director')).status).toBe(404);
  });
  it('active embedding space is exposed (sanitized)', async () => {
    const b = await (await get('/api/providers/embedding-spaces/active', 'director')).json();
    expect(typeof b.spaceKey).toBe('string');
    expect(b.identity.dimension).toBeGreaterThan(0);
  });
  it('real-vs-fallback comparison runs, records both arms, is retrievable', async () => {
    const b = await (await post('/api/providers/evaluations/compare', { maxScenarios: 1 }, 'director')).json();
    expect(b.status).toBe('COMPLETED');
    expect(b.realAvailable).toBe(false); // offline
    // Offline: real arm degrades to deterministic fallback → recorded as fallback, not real-accepted.
    expect(b.realAcceptedCount).toBe(0);
    expect(b.results.length).toBeGreaterThan(0);
    const one = await (await get(`/api/providers/evaluations/${b.comparisonRunId}`, 'director')).json();
    expect(Array.isArray(one.results)).toBe(true);
    const list = await (await get('/api/providers/evaluations?limit=5', 'director')).json();
    expect(list.total).toBeGreaterThan(0);
  });
  it('observability snapshot includes provider block + no secrets', async () => {
    const b = await (await get('/api/observability/snapshot?range=ALL', 'director')).json();
    expect(b.providers).toBeTruthy();
    expect(['OFFLINE', 'CONFIGURED', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE']).toContain(b.providers.llm.operatingMode);
    const s = JSON.stringify(b);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});
