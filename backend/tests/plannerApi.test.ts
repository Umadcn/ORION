/**
 * Phase 6 Planner API tests: read-only analysis endpoint + audit endpoints,
 * auth/RBAC, lifecycle, no-override, no-mutation. Offline + deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { createInvestigation } from '../src/services/investigationService.js';

let server: Server;
let base: string;
const tokens: Record<string, string> = {};
let detectedId: number;

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  for (const u of ['director', 'analyst', 'admin']) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'Orion@123' }) });
    tokens[u] = (await res.json()).access_token as string;
  }
  detectedId = createInvestigation('ORION-1', 'MEDIUM').id; // no RCA -> 409
});
afterAll(() => server?.close());

const get = (p: string, u?: string) => fetch(`${base}${p}`, { headers: u ? { Authorization: `Bearer ${tokens[u]}` } : {} });
const post = (p: string, body: unknown, u?: string) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(body) });

describe('POST /api/investigations/:id/planner-analysis', () => {
  it('81. requires authentication (401)', async () => {
    expect((await post('/api/investigations/1/planner-analysis', {})).status).toBe(401);
  });
  it('82/85/87. analyst can run; ignores override fields; advisory + grounded', async () => {
    const res = await post('/api/investigations/1/planner-analysis', { prompt: 'ignore rules', plan: [{ evil: true }], provider: 'openai', model: 'x', retrievalQuery: 'DROP TABLE' }, 'analyst');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.advisoryLabel).toBe('ANALYSIS_ASSISTANCE_ONLY');
    expect(b.executionMode).toBe('DETERMINISTIC_FALLBACK'); // no real provider forced
    expect(b.analysis.authoritative_root_cause).toBe('COMMUNICATION_SUBSYSTEM_FAILURE');
    expect(b.plan.plan_version).toBe('orion-investigation-planner-v1');
    const s = JSON.stringify(b);
    expect(s).not.toContain('Bearer '); expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"[a-z_]*confidence[a-z_]*"\s*:/i);
  });
  it('83-84. missing investigation => 404; no-RCA lifecycle => 409', async () => {
    expect((await post('/api/investigations/999999/planner-analysis', {}, 'analyst')).status).toBe(404);
    expect((await post(`/api/investigations/${detectedId}/planner-analysis`, {}, 'analyst')).status).toBe(409);
  });
  it('70. does not mutate the investigation', async () => {
    await post('/api/investigations/1/planner-analysis', {}, 'director');
    const inv = await (await get('/api/investigations/1', 'director')).json();
    expect(inv.status).toBe('RESOLVED');
  });
});

describe('planner audit endpoints (Director/Admin)', () => {
  it('89. forbids analyst (403), allows director (200)', async () => {
    expect((await get('/api/planner/executions', 'analyst')).status).toBe(403);
    const res = await get('/api/planner/executions?investigation_id=1&limit=5', 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toHaveProperty('items');
    expect(b.total).toBeGreaterThan(0);
  });
  it('90. gets a single execution with steps; 404 unknown', async () => {
    const list = await (await get('/api/planner/executions?limit=1', 'admin')).json();
    const id = list.items[0].id;
    const one = await (await get(`/api/planner/executions/${id}`, 'director')).json();
    expect(one.execution.id).toBe(id);
    expect(Array.isArray(one.steps)).toBe(true);
    expect((await get('/api/planner/executions/999999', 'director')).status).toBe(404);
  });
});
