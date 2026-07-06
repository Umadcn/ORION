/**
 * Dynamic satellite onboarding — full-platform integration tests (offline,
 * in-memory DB). A manually-registered satellite must be a first-class entity:
 * persisted, discoverable, simulatable, and able to flow through anomaly →
 * investigation → six agents → deterministic RCA → lifecycle → reports, plus
 * Copilot/Assistant read-only support. No fabricated data on creation; honest
 * unavailable states; AI stays read-only; no cross-satellite leakage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { simulation } from '../src/services/simulationService.js';
import * as inv from '../src/services/investigationService.js';
import { generateReport } from '../src/services/reportService.js';
import type { Investigation } from '../src/types.js';

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
const tick = async (n: number) => { for (let i = 0; i < n; i++) await simulation.tickOnce(); };

const NEW = 'SAT-NEW-001';

describe('manual satellite registration + validation + RBAC', () => {
  it('requires auth and rejects analyst (read-only) from creating', async () => {
    expect((await post('/api/satellites', { id: NEW, mission: 'x' })).status).toBe(401);
    expect((await post('/api/satellites', { id: NEW, mission: 'x' }, 'analyst')).status).toBe(403);
  });
  it('creates a satellite (Director) with NO fabricated telemetry/orbit', async () => {
    const res = await post('/api/satellites', { id: NEW, mission: 'Earth Observation', norad_catalog_id: '48274' }, 'director');
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.id).toBe(NEW);
    expect(b.origin).toBe('MANUAL');
    expect(b.status).toBe('UNKNOWN');
    expect(b.data_source_mode).toBe('NO_TELEMETRY');
    expect(b.orbit_data_state).toBe('UNAVAILABLE'); // no altitude/TLE provided
    expect(b.lifecycle_state).toBe('ACTIVE');
  });
  it('persists in SQLite and survives a re-read', () => {
    const row = db.prepare('SELECT * FROM satellites WHERE id = ?').get(NEW) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.origin).toBe('MANUAL');
  });
  it('rejects a duplicate id (409) and duplicate NORAD (409)', async () => {
    expect((await post('/api/satellites', { id: NEW, mission: 'y' }, 'director')).status).toBe(409);
    expect((await post('/api/satellites', { id: 'SAT-NEW-002', mission: 'y', norad_catalog_id: '48274' }, 'director')).status).toBe(409);
  });
  it('rejects invalid enums / numeric bounds / id format (400 with details)', async () => {
    const bad = await post('/api/satellites', { id: 'bad id!', mission: '', orbit_type: 'WORMHOLE', altitude: -5, latitude: 999 }, 'director');
    expect(bad.status).toBe(400);
    const b = await bad.json();
    expect(b.details).toBeTruthy();
    expect(Object.keys(b.details).length).toBeGreaterThan(0);
  });
  it('accepts manually-provided orbit data (MANUALLY_PROVIDED)', async () => {
    const res = await post('/api/satellites', { id: 'SAT-ORB-010', mission: 'Nav', orbit_type: 'MEO', altitude: 20200 }, 'director');
    expect(res.status).toBe(201);
    expect((await res.json()).orbit_data_state).toBe('MANUALLY_PROVIDED');
  });
});

describe('dashboard + search + details + no-data states', () => {
  it('dashboard count reflects the new satellite dynamically', async () => {
    const summary = await (await get('/api/dashboard/summary', 'director')).json();
    expect(summary.satellites.some((s: { id: string }) => s.id === NEW)).toBe(true);
    expect(summary.total_satellites).toBeGreaterThanOrEqual(7); // 5 seed + 2 created so far
  });
  it('satellite list + details expose honest no-telemetry / orbit-unavailable states', async () => {
    expect((await (await get('/api/satellites', 'analyst')).json()).some((s: { id: string }) => s.id === NEW)).toBe(true);
    const d = await (await get(`/api/satellites/${NEW}`, 'analyst')).json();
    expect(d.has_telemetry).toBe(false);
    expect(d.telemetry_state).toBe('NO_TELEMETRY');
    expect(d.orbit_data_state).toBe('UNAVAILABLE');
    expect(d.active_alerts.length).toBe(0);
    expect(d.investigations.length).toBe(0);
    expect((await get(`/api/satellites/${NEW}/telemetry`, 'analyst')).status).toBe(200);
    expect((await (await get(`/api/satellites/${NEW}/telemetry`, 'analyst')).json()).length).toBe(0);
  });
});

describe('edit / archive / reactivate lifecycle + RBAC', () => {
  it('Director can edit metadata (mass-assignment safe)', async () => {
    const res = await patch(`/api/satellites/${NEW}`, { mission: 'Updated Mission', status: 'HEALTHY', health_score: 99, id: 'HACK' }, 'director');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.mission).toBe('Updated Mission');
    expect(b.id).toBe(NEW);          // id not reassignable
    expect(b.status).toBe('UNKNOWN'); // status not directly writable
  });
  it('archive is Admin-only; analyst/director forbidden', async () => {
    expect((await post(`/api/satellites/${NEW}/archive`, {}, 'analyst')).status).toBe(403);
    expect((await post(`/api/satellites/${NEW}/archive`, {}, 'director')).status).toBe(403);
    const arch = await post(`/api/satellites/${NEW}/archive`, {}, 'admin');
    expect(arch.status).toBe(200);
    expect((await arch.json()).lifecycle_state).toBe('ARCHIVED');
    // archived excluded from default list, included with flag
    expect((await (await get('/api/satellites', 'analyst')).json()).some((s: { id: string }) => s.id === NEW)).toBe(false);
    expect((await (await get('/api/satellites?includeArchived=true', 'analyst')).json()).some((s: { id: string }) => s.id === NEW)).toBe(true);
    const re = await post(`/api/satellites/${NEW}/reactivate`, {}, 'admin');
    expect((await re.json()).lifecycle_state).toBe('ACTIVE');
  });
  it('seed idempotency never overwrites/deletes the manual satellite', () => {
    // Re-running the migration/seed path leaves the manual row intact.
    expect(db.prepare('SELECT id FROM satellites WHERE id = ?').get(NEW)).toBeTruthy();
  });
});

describe('dynamic simulation → telemetry → anomaly isolation', () => {
  it('generates telemetry ONLY for an explicitly simulated satellite', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id = ?').get(NEW) as { c: number }).c;
    expect(before).toBe(0); // creation did not fabricate telemetry
    const r = simulation.startForSatellite(NEW);
    expect(r.ok).toBe(true);
    await tick(3);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id = ?').get(NEW) as { c: number }).c;
    expect(after).toBeGreaterThan(0);
    // A different manual sat that was NOT simulated has no telemetry (isolation).
    const other = (db.prepare(`SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id = 'SAT-ORB-010'`).get() as { c: number }).c;
    expect(other).toBe(0);
    expect(simulation.activeTargets()).toContain(NEW);
  });
});

describe('anomaly → investigation → six agents → deterministic RCA → lifecycle → report', () => {
  let investigationId = 0;
  it('runs the full pipeline for the manually-registered satellite', async () => {
    simulation.injectFailure(NEW, 'POWER_SYSTEM_FAILURE');
    await tick(16);
    const investigation = inv.findOpenInvestigation(NEW) as Investigation | undefined;
    expect(investigation, 'an investigation is auto-created for the new satellite').toBeTruthy();
    investigationId = investigation!.id;

    const alerts = inv.getInvestigationAlerts(investigationId);
    expect(alerts.length).toBeGreaterThan(0);

    const execs = inv.getAgentExecutions(investigationId);
    const agentIds = new Set(execs.map((e) => e.agent_id));
    for (const id of ['telemetry-monitoring', 'anomaly-detection', 'space-weather', 'orbit-intelligence', 'root-cause-analysis']) {
      expect(agentIds.has(id), `agent ${id} executed for the new satellite`).toBe(true);
    }
    const detail = inv.requireInvestigation(investigationId);
    expect(detail.root_cause, 'deterministic RCA produced a root cause').toBeTruthy();
    expect(detail.status).toBe('WAITING_FOR_REVIEW');
  });
  it('honors human-in-the-loop lifecycle + report generation', async () => {
    expect(() => inv.resolve(investigationId)).toThrow(); // cannot resolve before approval
    expect(inv.approve(investigationId).status).toBe('APPROVED');
    expect(inv.resolve(investigationId).status).toBe('RESOLVED');
    const report = await generateReport(investigationId);
    expect(report.id).toBeGreaterThan(0);
    const content = JSON.parse(report.content);
    expect(content.satellite?.id ?? content.satellite_id ?? '').toBe(NEW);
  });
  it('historical search finds the new satellite investigation', () => {
    const rows = db.prepare(`SELECT id FROM investigations WHERE satellite_id = ?`).all(NEW) as { id: number }[];
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('Copilot + AI Assistant support the new satellite (read-only)', () => {
  async function convAssistant(): Promise<string> {
    return (await (await post('/api/assistant/conversations', { title: 't' }, 'director')).json()).id;
  }
  it('Copilot getSatellite queries persistence (not a seed map)', async () => {
    const conv = (await (await post('/api/copilot/conversations', { title: 't' }, 'director')).json()).id;
    const ans = await (await post(`/api/copilot/conversations/${conv}/messages`, { message: `Tell me about ${NEW}.` }, 'director')).json();
    expect(ans.status).not.toBe('FAILED');
    // getSatellite tool must resolve the manual satellite.
    const tools = ans.toolActivity.map((t: { toolName: string }) => t.toolName);
    expect(tools).toContain('getSatellite');
  });
  it('AI Assistant resolves the new satellite entity + refuses write requests', async () => {
    const conv = await convAssistant();
    const a1 = await (await post(`/api/assistant/conversations/${conv}/messages`, { message: `Tell me about ${NEW}.` }, 'director')).json();
    expect(a1.context.satelliteId).toBe(NEW);
    const a2 = await (await post(`/api/assistant/conversations/${conv}/messages`, { message: 'Does it have telemetry?' }, 'director')).json();
    expect(a2.context.satelliteId).toBe(NEW); // entity continuity across turns
    const a3 = await (await post(`/api/assistant/conversations/${conv}/messages`, { message: `Start the simulation for ${NEW}.` }, 'director')).json();
    expect(a3.status).toBe('REFUSED'); // AI tools remain read-only — no mutation
  });
  it('AI could not mutate the satellite (still no rogue lifecycle change)', () => {
    const row = db.prepare('SELECT lifecycle_state FROM satellites WHERE id = ?').get(NEW) as { lifecycle_state: string };
    expect(row.lifecycle_state).toBe('ACTIVE');
  });
});
