/**
 * Phase 1 LLM API tests: RBAC, status sanitization, pagination — against the
 * real Express app on an ephemeral port with an in-memory DB. No network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => server?.close());

async function token(username: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Orion@123' }),
  });
  return (await res.json()).access_token as string;
}
const get = (path: string, tok?: string) =>
  fetch(`${base}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });

describe('startup without LLM config', () => {
  it('the app builds and serves with no ORION_LLM_* set (offline-first)', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/llm/status', () => {
  it('requires authentication (401)', async () => {
    expect((await get('/api/llm/status')).status).toBe(401);
  });
  it('forbids an analyst (403)', async () => {
    expect((await get('/api/llm/status', await token('analyst'))).status).toBe(403);
  });
  it('allows director + returns sanitized config (no secrets), default fallback mode', async () => {
    const res = await get('/api/llm/status', await token('director'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operating_mode).toBe('DETERMINISTIC_FALLBACK'); // no real provider in tests
    expect(body.real_provider_configured).toBe(false);
    expect(body.fallback_enabled).toBe(true);
    // No secret material must be present anywhere in the payload.
    const s = JSON.stringify(body);
    expect(s).not.toMatch(/api[_-]?key"?\s*[:=]\s*"?[A-Za-z0-9]/i);
    expect(s).not.toContain('Bearer ');
    expect(body.apiKey).toBeUndefined();
  });
  it('allows admin', async () => {
    expect((await get('/api/llm/status', await token('admin'))).status).toBe(200);
  });
});

describe('GET /api/llm/executions', () => {
  it('is director-accessible and paginated', async () => {
    const res = await get('/api/llm/executions?limit=5', await token('director'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('items');
    expect(body.limit).toBe(5);
    expect(Array.isArray(body.items)).toBe(true);
  });
  it('forbids an analyst (403)', async () => {
    expect((await get('/api/llm/executions', await token('analyst'))).status).toBe(403);
  });
  it('returns 404 for an unknown execution id', async () => {
    expect((await get('/api/llm/executions/999999', await token('director'))).status).toBe(404);
  });
});
