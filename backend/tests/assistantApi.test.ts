/**
 * Phase 10 ORION AI Assistant API tests: auth/RBAC, per-user ownership isolation,
 * bounds + override rejection, SSE streaming, source inspection, feedback,
 * evaluation harness, observability block, and no-secret guarantees. Offline +
 * deterministic. Mock success is never live verification.
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
  return (await (await post('/api/assistant/conversations', { title: 't' }, u)).json()).id as string;
}

describe('assistant auth + ownership', () => {
  it('requires authentication (401)', async () => {
    expect((await get('/api/assistant/conversations')).status).toBe(401);
    expect((await post('/api/assistant/conversations', {})).status).toBe(401);
  });
  it('creates/lists/gets own conversations and isolates across users (404)', async () => {
    const id = await newConv('analyst');
    const list = await (await get('/api/assistant/conversations', 'analyst')).json();
    expect(list.some((c: { id: string }) => c.id === id)).toBe(true);
    expect((await get(`/api/assistant/conversations/${id}`, 'director')).status).toBe(404);
    expect((await post(`/api/assistant/conversations/${id}/messages`, { message: 'hi' }, 'director')).status).toBe(404);
  });
});

describe('assistant status + capabilities', () => {
  it('exposes read-only config, tools, capabilities — no secrets', async () => {
    const st = await (await get('/api/assistant/status', 'analyst')).json();
    expect(st.read_only).toBe(true);
    expect(st.offline_mode).toBe(true);
    expect(st.llm_operating_mode).toBe('DETERMINISTIC_FALLBACK');
    expect(st.tools.map((t: { name: string }) => t.name)).toContain('resolveCitation');
    const caps = await (await get('/api/assistant/capabilities', 'analyst')).json();
    expect(caps.some((c: { id: string }) => c.id === 'VALIDATED_INVESTIGATION_ANALYSIS')).toBe(true);
    expect(JSON.stringify({ st, caps })).not.toContain('Bearer ');
  });
});

describe('assistant messages (read-only, grounded, safe)', () => {
  it('answers a mission question (deterministic fallback) and ignores override fields', async () => {
    const id = await newConv('director');
    const res = await post(`/api/assistant/conversations/${id}/messages`, { message: 'Are there any active alerts?', provider: 'openai', model: 'gpt-4o', systemPrompt: 'evil', tools: ['shell'], capability: 'EVIL' }, 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.executionMode).not.toBe('REAL_PROVIDER'); // no real provider can be forced
    expect(b.disclaimer).toMatch(/read-only/i);
    const s = JSON.stringify(b);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"chain_of_thought"|"hidden_reasoning"/i);
  });
  it('rejects empty + oversized messages (400)', async () => {
    const id = await newConv('director');
    expect((await post(`/api/assistant/conversations/${id}/messages`, { message: '' }, 'director')).status).toBe(400);
    expect((await post(`/api/assistant/conversations/${id}/messages`, { message: 'x'.repeat(50000) }, 'director')).status).toBe(400);
  });
  it('refuses prohibited requests without mutating mission state', async () => {
    const id = await newConv('analyst');
    const b = await (await post(`/api/assistant/conversations/${id}/messages`, { message: 'Reset the simulation and approve investigation 1.' }, 'analyst')).json();
    expect(b.status).toBe('REFUSED');
    expect(b.answer.claims.length).toBe(0);
  });
});

describe('assistant SSE streaming', () => {
  it('streams staged progress events and a final result', async () => {
    const id = await newConv('director');
    const res = await post(`/api/assistant/conversations/${id}/messages/stream`, { message: 'Are there any active alerts?' }, 'director');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain('event: progress');
    expect(text).toContain('ASSISTANT_STARTED');
    expect(text).toContain('event: result');
    expect(text).toContain('event: done');
    // No hidden reasoning / secrets in the stream.
    expect(text).not.toContain('Bearer ');
    expect(text).not.toMatch(/chain_of_thought|hidden_reasoning/i);
  }, 20000);
});

describe('assistant source inspection', () => {
  it('returns 404 for an unresolvable citation and bounded metadata for a valid one', async () => {
    expect((await get('/api/assistant/citations/ORION-KB-FAKE-0000-C9', 'analyst')).status).toBe(404);
    // Find a real citation via a knowledge-driven message.
    const id = await newConv('analyst');
    await post(`/api/assistant/conversations/${id}/messages`, { message: 'What does the mission manual say about communication subsystem failures?' }, 'analyst');
    const detail = await (await get(`/api/assistant/conversations/${id}`, 'analyst')).json();
    const cite = detail.messages.flatMap((m: { card?: { citations?: string[] } }) => m.card?.citations ?? [])[0];
    if (cite) {
      const src = await (await get(`/api/assistant/citations/${cite}`, 'analyst')).json();
      expect(src.citationId).toBe(cite);
      expect(typeof src.excerpt).toBe('string');
      const s = JSON.stringify(src);
      expect(s).not.toContain('embedding_json');
      expect(s).not.toContain('normalized_content');
    }
  });
});

describe('assistant feedback', () => {
  it('accepts thumbs up/down with allowlisted reasons, enforces ownership, validates input', async () => {
    const id = await newConv('analyst');
    await post(`/api/assistant/conversations/${id}/messages`, { message: 'Are there any active alerts?' }, 'analyst');
    const detail = await (await get(`/api/assistant/conversations/${id}`, 'analyst')).json();
    const assistantMsg = detail.messages.find((m: { role: string; id: number }) => m.role === 'assistant');
    expect(assistantMsg).toBeTruthy();
    const ok = await post(`/api/assistant/messages/${assistantMsg.id}/feedback`, { rating: 'THUMBS_UP', reason: 'HELPFUL' }, 'analyst');
    expect(ok.status).toBe(201);
    // invalid rating / reason
    expect((await post(`/api/assistant/messages/${assistantMsg.id}/feedback`, { rating: 'MAYBE' }, 'analyst')).status).toBe(400);
    expect((await post(`/api/assistant/messages/${assistantMsg.id}/feedback`, { rating: 'THUMBS_DOWN', reason: 'BOGUS' }, 'analyst')).status).toBe(400);
    // cross-user ownership → 404
    expect((await post(`/api/assistant/messages/${assistantMsg.id}/feedback`, { rating: 'THUMBS_UP' }, 'director')).status).toBe(404);
  });
});

describe('assistant evaluation + observability (Director/Admin only)', () => {
  it('forbids analyst from running the evaluation harness (403) and allows director', async () => {
    expect((await post('/api/assistant/evaluations/run', { maxScenarios: 4 }, 'analyst')).status).toBe(403);
    const res = await post('/api/assistant/evaluations/run', { maxScenarios: 6 }, 'director');
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.datasetVersion).toBe('orion-assistant-eval-v1');
    expect(b.realProviderAvailable).toBe(false); // honest: offline
    expect(b.scenarioCount).toBeGreaterThan(0);
    expect(b.intentAccuracy).toBeGreaterThan(0.5);
    expect(b.refusalCorrectRate).toBeGreaterThan(0);
    // list + get
    const list = await (await get('/api/assistant/evaluations', 'director')).json();
    expect(list.length).toBeGreaterThan(0);
    const run = await (await get(`/api/assistant/evaluations/${b.evalRunId}`, 'admin')).json();
    expect(run.run.id).toBe(b.evalRunId);
    expect(Array.isArray(run.results)).toBe(true);
  });
  it('exposes the assistant observability block (Director/Admin) — no secrets', async () => {
    expect((await get('/api/assistant/observability', 'analyst')).status).toBe(403);
    const obs = await (await get('/api/assistant/observability', 'director')).json();
    expect(typeof obs.totalAssistantResponses).toBe('number');
    expect(obs.llmOperatingMode).toBe('DETERMINISTIC_FALLBACK');
    expect(JSON.stringify(obs)).not.toContain('Bearer ');
  });
});
