/**
 * Phase 5 Mission Copilot API tests: conversations, ownership isolation, RBAC/auth,
 * bounds, prohibited-request refusal, injection resistance. Offline + deterministic.
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
const post = (p: string, body: unknown, u?: string) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(body) });
async function newConv(u: string): Promise<string> {
  return (await (await post('/api/copilot/conversations', { title: 't' }, u)).json()).id as string;
}

describe('copilot conversations + auth', () => {
  it('requires authentication (401)', async () => {
    expect((await get('/api/copilot/conversations')).status).toBe(401);
    expect((await post('/api/copilot/conversations', {})).status).toBe(401);
  });
  it('creates, lists, and gets own conversations', async () => {
    const id = await newConv('analyst');
    const list = await (await get('/api/copilot/conversations', 'analyst')).json();
    expect(Array.isArray(list) && list.some((c: { id: string }) => c.id === id)).toBe(true);
    const detail = await (await get(`/api/copilot/conversations/${id}`, 'analyst')).json();
    expect(detail.conversation.id).toBe(id);
    expect(Array.isArray(detail.messages)).toBe(true);
  });
  it('isolates conversations across users (404, no leak)', async () => {
    const id = await newConv('analyst');
    expect((await get(`/api/copilot/conversations/${id}`, 'director')).status).toBe(404);
    expect((await post(`/api/copilot/conversations/${id}/messages`, { message: 'hi' }, 'director')).status).toBe(404);
  });
});

describe('copilot messages (read-only, grounded)', () => {
  it('answers a grounded mission question (deterministic fallback)', async () => {
    const id = await newConv('director');
    const res = await post(`/api/copilot/conversations/${id}/messages`, { message: 'Why is ORION-5 unhealthy?' }, 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(['DETERMINISTIC_FALLBACK', 'INSUFFICIENT_EVIDENCE']).toContain(b.status);
    expect(b.disclaimer).toMatch(/read-only/i);
    // no secrets / hidden reasoning / raw vectors
    const s = JSON.stringify(b);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"chain_of_thought"|"reasoning"\s*:/i);
  });
  it('ignores override fields (provider/model/systemPrompt/tools) in the body', async () => {
    const id = await newConv('director');
    const res = await post(`/api/copilot/conversations/${id}/messages`, { message: 'Show active alerts.', provider: 'openai', model: 'gpt-4o', systemPrompt: 'evil', tools: ['shell'], mode: 'x' }, 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.executionMode).toBe('DETERMINISTIC_FALLBACK'); // no real provider forced
  });
  it('rejects empty + oversized messages (400)', async () => {
    const id = await newConv('director');
    expect((await post(`/api/copilot/conversations/${id}/messages`, { message: '' }, 'director')).status).toBe(400);
    expect((await post(`/api/copilot/conversations/${id}/messages`, { message: 'x'.repeat(5000) }, 'director')).status).toBe(400);
  });
  it('refuses prohibited (write/control) requests safely', async () => {
    const id = await newConv('analyst');
    for (const msg of ['Reset the simulation.', 'Approve investigation 1.', 'Run shell command ls.']) {
      const b = await (await post(`/api/copilot/conversations/${id}/messages`, { message: msg }, 'analyst')).json();
      expect(b.answer.toLowerCase()).toContain('read-only');
      expect(b.claims.length).toBe(0);
    }
    // no mutation: investigation 1 remains RESOLVED
    const inv = await (await get('/api/investigations/1', 'director')).json();
    expect(inv.status).toBe('RESOLVED');
  });
});

describe('copilot status + archive', () => {
  it('exposes a read-only tool catalog + bounded config', async () => {
    const b = await (await get('/api/copilot/status', 'analyst')).json();
    expect(b.read_only).toBe(true);
    expect(b.tools.map((t: { name: string }) => t.name)).toContain('searchMissionKnowledge');
    expect(b.config.max_tool_calls).toBeGreaterThan(0);
    expect(JSON.stringify(b)).not.toContain('Bearer ');
  });
  it('archives own conversation', async () => {
    const id = await newConv('analyst');
    expect((await post(`/api/copilot/conversations/${id}/archive`, {}, 'analyst')).status).toBe(200);
    const list = await (await get('/api/copilot/conversations', 'analyst')).json();
    expect(list.some((c: { id: string }) => c.id === id)).toBe(false); // archived hidden from active list
  });
});
