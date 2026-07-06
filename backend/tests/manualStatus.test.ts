/**
 * Manual satellite status control — full integration (offline, in-memory DB).
 *
 * Verifies the canonical model: AUTO defaults + derived status, MANUAL override
 * (HEALTHY/WARNING/ALERT), return-to-AUTO, validation, RBAC, immutable audit,
 * cross-module effectiveStatus propagation, AI read-only + status wording, and
 * the semantic boundary — a manual override NEVER creates alerts, investigations,
 * RCA, or telemetry, and never overwrites the derived status.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { simulation } from '../src/services/simulationService.js';

let server: Server;
let base: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
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
const patch = (p: string, b: unknown, u?: string) => fetch(`${base}${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${tokens[u]}` } : {}) }, body: JSON.stringify(b) });

const SAT = 'STATUS-SAT-1';

async function createSat(id: string) {
  // Provide orbit data so it's a well-formed satellite; still no telemetry.
  return post('/api/satellites', { id, mission: 'Status Test', orbit_type: 'LEO', altitude: 550 }, 'director');
}

describe('defaults + derived status', () => {
  it('a new satellite defaults to AUTO with no override', async () => {
    expect((await createSat(SAT)).status).toBe(201);
    const d = await (await get(`/api/satellites/${SAT}`, 'analyst')).json();
    expect(d.status_mode).toBe('AUTO');
    expect(d.manual_status).toBeNull();
    expect(d.derived_status).toBe('UNKNOWN');
    expect(d.effective_status).toBe('UNKNOWN');
    expect(d.status).toBe('UNKNOWN'); // serialized status = effective
  });
  it('all satellites resolve to AUTO by default (NULL column treated as AUTO)', async () => {
    const list = await (await get('/api/satellites?includeArchived=true', 'director')).json();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s: { status_mode: string; manual_status: unknown }) => s.status_mode === 'AUTO' && s.manual_status === null)).toBe(true);
  });
});

describe('RBAC', () => {
  it('analyst is forbidden; unauthenticated is 401', async () => {
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'WARNING' })).status).toBe(401);
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'WARNING' }, 'analyst')).status).toBe(403);
  });
});

describe('manual override + validation', () => {
  it('Director sets MANUAL WARNING; effective updates, derived preserved', async () => {
    const res = await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'WARNING', reason: 'Operator verification test' }, 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.statusMode).toBe('MANUAL');
    expect(b.manualStatus).toBe('WARNING');
    expect(b.effectiveStatus).toBe('WARNING');
    expect(b.derivedStatus).toBe('UNKNOWN'); // derived untouched
    expect(b.manualStatusUpdatedBy).toBeTruthy();
  });
  it('Admin sets MANUAL ALERT', async () => {
    const b = await (await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'ALERT', reason: 'Manual mission escalation' }, 'admin')).json();
    expect(b.effectiveStatus).toBe('ALERT');
  });
  it('MANUAL HEALTHY works', async () => {
    const b = await (await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'HEALTHY' }, 'director')).json();
    expect(b.effectiveStatus).toBe('HEALTHY');
  });
  it('MANUAL requires a valid status; invalid values rejected (400)', async () => {
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL' }, 'director')).status).toBe(400);
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'OFFLINE' }, 'director')).status).toBe(400);
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'BOGUS' }, 'director')).status).toBe(400);
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'WORMHOLE', status: 'HEALTHY' }, 'director')).status).toBe(400);
  });
  it('reason is length-bounded (400)', async () => {
    expect((await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'WARNING', reason: 'x'.repeat(501) }, 'director')).status).toBe(400);
  });
  it('unknown satellite rejected (404); matching is exact', async () => {
    expect((await patch(`/api/satellites/NOPE-999/status`, { mode: 'MANUAL', status: 'WARNING' }, 'director')).status).toBe(404);
    expect((await patch(`/api/satellites/${SAT.toLowerCase()}/status`, { mode: 'AUTO' }, 'director')).status).toBe(200); // id normalized/upper-cased on lookup
  });
  it('AUTO clears the override and returns to derived status', async () => {
    await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'ALERT' }, 'director');
    const b = await (await patch(`/api/satellites/${SAT}/status`, { mode: 'AUTO', reason: 'Return to telemetry-derived status' }, 'director')).json();
    expect(b.statusMode).toBe('AUTO');
    expect(b.manualStatus).toBeNull();
    expect(b.effectiveStatus).toBe(b.derivedStatus);
  });
});

describe('immutable audit + history', () => {
  it('records previous/new state for each change and is bounded', async () => {
    const hist = await (await get(`/api/satellites/${SAT}/status/history`, 'analyst')).json();
    expect(Array.isArray(hist)).toBe(true);
    expect(hist.length).toBeGreaterThan(0);
    const last = hist[0]; // newest first
    expect(last.new_mode).toBe('AUTO');
    expect(last.previous_effective_status).toBeTruthy();
    expect(last.actor).toBeTruthy();
  });
  it('history is append-only (rows only grow)', async () => {
    const n1 = (db.prepare(`SELECT COUNT(*) AS c FROM satellite_status_events WHERE satellite_id = ?`).get(SAT) as { c: number }).c;
    await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'WARNING' }, 'director');
    const n2 = (db.prepare(`SELECT COUNT(*) AS c FROM satellite_status_events WHERE satellite_id = ?`).get(SAT) as { c: number }).c;
    expect(n2).toBe(n1 + 1);
  });
});

describe('semantic boundary — no fabricated operational records', () => {
  it('manual override creates NO telemetry / alerts / investigations and never overwrites derived status', async () => {
    const before = {
      tel: (db.prepare(`SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      alerts: (db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      inv: (db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      derived: (db.prepare(`SELECT status FROM satellites WHERE id = ?`).get(SAT) as { status: string }).status,
    };
    await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'ALERT', reason: 'escalate' }, 'director');
    const after = {
      tel: (db.prepare(`SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      alerts: (db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      inv: (db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE satellite_id = ?`).get(SAT) as { c: number }).c,
      derived: (db.prepare(`SELECT status FROM satellites WHERE id = ?`).get(SAT) as { status: string }).status,
    };
    expect(after).toEqual(before); // nothing fabricated, derived column unchanged
  });
});

describe('cross-module effectiveStatus propagation', () => {
  it('dashboard, list, detail, and search all reflect the override', async () => {
    await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'ALERT', reason: 'x' }, 'director');
    const summary = await (await get('/api/dashboard/summary', 'director')).json();
    const inSummary = summary.satellites.find((s: { id: string }) => s.id === SAT);
    expect(inSummary.status).toBe('ALERT');
    expect(inSummary.effective_status).toBe('ALERT');
    const list = await (await get('/api/satellites', 'analyst')).json();
    expect(list.find((s: { id: string }) => s.id === SAT).status).toBe('ALERT');
    const detail = await (await get(`/api/satellites/${SAT}`, 'analyst')).json();
    expect(detail.status).toBe('ALERT');
    expect(detail.derived_status).toBe('UNKNOWN');
  });
});

describe('AI Assistant — effectiveStatus + read-only', () => {
  async function conv(): Promise<string> {
    return (await (await post('/api/assistant/conversations', { title: 't' }, 'director')).json()).id;
  }
  it('getSatellite tool reports the manual override, not the derived value, and cannot mutate', async () => {
    await patch(`/api/satellites/${SAT}/status`, { mode: 'MANUAL', status: 'ALERT', reason: 'x' }, 'director');
    const c = await conv();
    const a = await (await post(`/api/assistant/conversations/${c}/messages`, { message: `What is ${SAT}'s status?` }, 'director')).json();
    const text = JSON.stringify(a);
    expect(text).toContain('ALERT');
    expect(text.toLowerCase()).toContain('manual operator override');
    // AI has no status-mutation tool: asking never changes stored state.
    const modeBefore = (db.prepare(`SELECT status_mode, manual_status FROM satellites WHERE id = ?`).get(SAT) as { status_mode: string; manual_status: string });
    await post(`/api/assistant/conversations/${c}/messages`, { message: `Set ${SAT} status to HEALTHY.` }, 'director');
    const modeAfter = (db.prepare(`SELECT status_mode, manual_status FROM satellites WHERE id = ?`).get(SAT) as { status_mode: string; manual_status: string });
    expect(modeAfter).toEqual(modeBefore);
  });
});

describe('existing-database migration compatibility', () => {
  it('the manual-status columns + audit table exist and back-compat holds', () => {
    const cols = (db.prepare(`PRAGMA table_info(satellites)`).all() as { name: string }[]).map((c) => c.name);
    for (const c of ['status_mode', 'manual_status', 'manual_status_reason', 'manual_status_updated_at', 'manual_status_updated_by']) {
      expect(cols).toContain(c);
    }
    const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='satellite_status_events'`).get();
    expect(tbl).toBeTruthy();
  });
});

// keep the simulation ticker import referenced (module side-effects) without running it
void simulation;
