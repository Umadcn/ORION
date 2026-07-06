/**
 * Phase 8 observability API tests: Director/Admin RBAC, allowlisted ranges +
 * time-series metrics, read-only + no-mutation, bounded responses, no secrets.
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
  // Generate some AI activity so metrics are non-trivial.
  await post('/api/investigations/1/planner-analysis', {}, 'analyst');
});
afterAll(() => server?.close());

const get = (p: string, u?: string) => fetch(`${base}${p}`, { headers: u ? { Authorization: `Bearer ${tokens[u]}` } : {} });
const post = (p: string, b: unknown, u?: string) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(b) });

const ENDPOINTS = ['/status', '/overview', '/llm', '/retrieval', '/generation', '/copilot', '/planner', '/critic', '/governance', '/evaluations', '/snapshot'];

describe('observability RBAC', () => {
  it('requires authentication (401)', async () => {
    expect((await get('/api/observability/overview')).status).toBe(401);
  });
  it('forbids MISSION_ANALYST (403) on every endpoint', async () => {
    for (const e of ENDPOINTS) expect((await get(`/api/observability${e}`, 'analyst')).status).toBe(403);
    expect((await get('/api/observability/timeseries?metric=ai_executions', 'analyst')).status).toBe(403);
  });
  it('allows Director and Admin (200) on every endpoint', async () => {
    for (const e of ENDPOINTS) {
      expect((await get(`/api/observability${e}`, 'director')).status).toBe(200);
      expect((await get(`/api/observability${e}`, 'admin')).status).toBe(200);
    }
  });
});

describe('observability responses', () => {
  it('overview has expected KPI fields + offline labeling', async () => {
    const b = await (await get('/api/observability/overview?range=ALL', 'director')).json();
    expect(typeof b.totalAiExecutions).toBe('number');
    expect(b.offlineMode).toBe(true);
    expect(b.llmOperatingMode).toBe('DETERMINISTIC_FALLBACK');
    expect(b.embeddingOperatingMode).toBe('LOCAL_HASH_FALLBACK');
    expect(['number', 'object']).toContain(typeof b.retrievalNdcgAtK); // number or null
  });
  it('governance is advisory-only', async () => {
    const b = await (await get('/api/observability/governance?range=7D', 'director')).json();
    expect(b.advisory).toBe(true);
    expect(Array.isArray(b.alerts)).toBe(true);
  });
  it('invalid range falls back to the configured default (no error)', async () => {
    const b = await (await get('/api/observability/overview?range=BOGUS', 'director')).json();
    expect(['24H', '7D', '30D', 'ALL']).toContain(b.timeRange);
  });
  it('invalid / missing time-series metric => 400; valid => bounded points', async () => {
    expect((await get('/api/observability/timeseries?metric=DROP', 'director')).status).toBe(400);
    expect((await get('/api/observability/timeseries', 'director')).status).toBe(400);
    const ok = await get('/api/observability/timeseries?metric=ai_executions&range=7D', 'director');
    expect(ok.status).toBe(200);
    const b = await ok.json();
    expect(Array.isArray(b.points)).toBe(true);
    expect(b.points.length).toBeLessThanOrEqual(500);
  });
  it('no secrets / raw prompts / raw responses / vectors in any response', async () => {
    const s = JSON.stringify(await (await get('/api/observability/snapshot?range=ALL', 'director')).json());
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"(prompt|response_summary|request_summary|chain_of_thought)"\s*:/i);
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
  it('does not mutate mission state (investigation 1 remains RESOLVED)', async () => {
    await get('/api/observability/snapshot?range=ALL', 'director');
    const inv = await (await get('/api/investigations/1', 'director')).json();
    expect(inv.status).toBe('RESOLVED');
  });
});
