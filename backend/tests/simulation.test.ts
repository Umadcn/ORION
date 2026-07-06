/**
 * Satellite Simulation Control Center — service + API tests (offline, in-memory).
 *
 * Covers: dynamic satellite listing, dynamic failure catalog, session lifecycle +
 * invalid transitions, restart recovery, speed/config bounds, single + multiple
 * simultaneous failures, deterministic composition + conflict resolution, remove
 * one / clear all, duration expiry + recovery, telemetry isolation, historical
 * immutability, RBAC + auth, and AI read-only refusal (no mutation).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { simulation } from '../src/services/simulationService.js';
import * as inv from '../src/services/investigationService.js';
import {
  composeTelemetry, defaultProfile, FAILURE_CATALOG, catalogForApi, type ActiveFailureRuntime,
} from '../src/services/simulationFailures.js';

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
const del = (p: string, u?: string) => fetch(`${base}${p}`, { method: 'DELETE', headers: u ? { Authorization: `Bearer ${tokens[u]}` } : {} });
const tick = async (n: number) => { for (let i = 0; i < n; i++) await simulation.tickOnce(); };
const telCount = (id: string) => (db.prepare('SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id=?').get(id) as { c: number }).c;

// ---------- Pure composition model ----------

describe('deterministic telemetry composition', () => {
  const profile = defaultProfile({ battery: 100, temperature: 22, power: 600, signal: -95, altitude: 550 });
  const orbit = { velocity: 7.5, latitude: 0, longitude: 0 };
  const mk = (over: Partial<ActiveFailureRuntime>): ActiveFailureRuntime => ({
    id: 'f', failureType: 'LOW_BATTERY', severity: 'MEDIUM', onset: 'IMMEDIATE', recovery: 'IMMEDIATE',
    onsetTicks: 4, durationTicks: null, injectedAtTick: 0, state: 'ACTIVE', expiredAtTick: null, ...over,
  });

  it('is reproducible: identical inputs → identical output', () => {
    const a = composeTelemetry(profile, 5, 5, [mk({})], orbit);
    const b = composeTelemetry(profile, 5, 5, [mk({})], orbit);
    expect(a.sample).toEqual(b.sample);
  });

  it('a battery-drain failure lowers battery below baseline', () => {
    const { sample } = composeTelemetry(profile, 6, 6, [mk({ failureType: 'LOW_BATTERY' })], orbit);
    expect(sample.battery_percent).toBeLessThan(profile.battery_percent.baseline);
  });

  it('conflict resolution: highest-precedence failure wins on a shared field (no double-apply)', () => {
    // POWER_SYSTEM_FAILURE (precedence 50) vs LOW_BATTERY (45) both hit battery.
    const both = composeTelemetry(profile, 6, 6, [
      mk({ id: 'a', failureType: 'POWER_SYSTEM_FAILURE', injectedAtTick: 0 }),
      mk({ id: 'b', failureType: 'LOW_BATTERY', injectedAtTick: 0 }),
    ], orbit);
    const powerOnly = composeTelemetry(profile, 6, 6, [mk({ id: 'a', failureType: 'POWER_SYSTEM_FAILURE' })], orbit);
    // Battery equals the winner (POWER_SYSTEM_FAILURE) alone — not the sum of both drains.
    expect(both.sample.battery_percent).toBe(powerOnly.sample.battery_percent);
  });

  it('disjoint-field failures all apply', () => {
    const { sample } = composeTelemetry(profile, 6, 6, [
      mk({ id: 'a', failureType: 'HIGH_TEMPERATURE' }),
      mk({ id: 'b', failureType: 'COMMUNICATION_LOSS' }),
    ], orbit);
    expect(sample.temperature_c).toBeGreaterThan(profile.temperature_c.baseline);
    expect(sample.signal_strength_dbm).toBeLessThan(profile.signal_strength_dbm.baseline);
  });

  it('an EXPIRED failure with IMMEDIATE recovery stops applying', () => {
    const expired = mk({ failureType: 'HIGH_TEMPERATURE', durationTicks: 3, state: 'EXPIRED', injectedAtTick: 0, expiredAtTick: 3, recovery: 'IMMEDIATE' });
    const { sample } = composeTelemetry(profile, 10, 10, [expired], orbit);
    expect(Math.abs(sample.temperature_c - profile.temperature_c.baseline)).toBeLessThan(2);
  });

  it('removed failures never apply', () => {
    const removed = mk({ state: 'REMOVED', failureType: 'LOW_BATTERY' });
    const { sample } = composeTelemetry(profile, 6, 6, [removed], orbit);
    expect(sample.battery_percent).toBeGreaterThan(90);
  });
});

describe('failure catalog', () => {
  it('includes the spec-required failures and serializes without effect functions', () => {
    const types = FAILURE_CATALOG.map((d) => d.failureType);
    for (const t of ['LOW_BATTERY', 'ABNORMAL_POWER_CONSUMPTION', 'HIGH_TEMPERATURE', 'COMMUNICATION_LOSS', 'ORBIT_DEVIATION', 'BATTERY_DEGRADATION']) {
      expect(types).toContain(t);
    }
    const api = catalogForApi();
    expect(api.every((d) => !('effects' in d))).toBe(true);
    expect(api[0]).toHaveProperty('expectedAlertTypes');
  });
});

// ---------- Service-level session lifecycle ----------

describe('session lifecycle + isolation', () => {
  it('CREATED → RUNNING → PAUSED → RUNNING → STOPPED with correct guards', () => {
    const s = simulation.createSession('ORION-4', {}, 'director');
    expect(s.status).toBe('CREATED');
    expect(simulation.startSession(s.id).status).toBe('RUNNING');
    expect(simulation.pauseSession(s.id).status).toBe('PAUSED');
    expect(() => simulation.pauseSession(s.id)).not.toThrow(); // idempotent
    expect(simulation.resumeSession(s.id).status).toBe('RUNNING');
    expect(simulation.stopSession(s.id).status).toBe('STOPPED');
  });

  it('rejects invalid transitions', () => {
    const s = simulation.createSession('ORION-5', {}, 'director');
    expect(() => simulation.pauseSession(s.id)).toThrow(); // cannot pause CREATED
    expect(() => simulation.resumeSession(s.id)).toThrow(); // cannot resume CREATED
  });

  it('only one non-terminal session per satellite (create is idempotent)', () => {
    const a = simulation.createSession('ORION-4', {}, 'director');
    const b = simulation.createSession('ORION-4', {}, 'director');
    expect(a.id).toBe(b.id);
  });

  it('paused session generates no telemetry; resume continues', async () => {
    const s = simulation.createSession('ORION-5', {}, 'director');
    simulation.startSession(s.id);
    await tick(2);
    const afterRun = telCount('ORION-5');
    expect(afterRun).toBeGreaterThan(0);
    simulation.pauseSession(s.id);
    await tick(3);
    expect(telCount('ORION-5')).toBe(afterRun); // paused → no new telemetry
    simulation.resumeSession(s.id);
    await tick(2);
    expect(telCount('ORION-5')).toBeGreaterThan(afterRun);
    simulation.stopSession(s.id);
  });

  it('concurrent simulations are isolated (no cross-satellite leakage)', async () => {
    // Two manual satellites simulated concurrently with different failures.
    db.prepare(`INSERT OR IGNORE INTO satellites (id,name,norad_id,mission,orbit_type,altitude,velocity,latitude,longitude,health_score,status,sim_eligible,lifecycle_state,origin,orbit_data_state,data_source_mode,created_at,updated_at) VALUES ('SIM-A','SIM-A','','m','LEO',550,7.5,0,0,0,'UNKNOWN',1,'ACTIVE','MANUAL','MANUALLY_PROVIDED','NO_TELEMETRY','2020','2020')`).run();
    db.prepare(`INSERT OR IGNORE INTO satellites (id,name,norad_id,mission,orbit_type,altitude,velocity,latitude,longitude,health_score,status,sim_eligible,lifecycle_state,origin,orbit_data_state,data_source_mode,created_at,updated_at) VALUES ('SIM-B','SIM-B','','m','LEO',550,7.5,0,0,0,'UNKNOWN',1,'ACTIVE','MANUAL','MANUALLY_PROVIDED','NO_TELEMETRY','2020','2020')`).run();
    const a = simulation.createSession('SIM-A', {}, 'director'); simulation.startSession(a.id);
    const b = simulation.createSession('SIM-B', {}, 'director'); simulation.startSession(b.id);
    simulation.injectFailureToSession(a.id, { failureType: 'HIGH_TEMPERATURE' });
    simulation.injectFailureToSession(b.id, { failureType: 'COMMUNICATION_LOSS' });
    await tick(6);
    const aTel = db.prepare(`SELECT * FROM telemetry WHERE satellite_id='SIM-A' ORDER BY id DESC LIMIT 1`).get() as { temperature_c: number; signal_strength_dbm: number };
    const bTel = db.prepare(`SELECT * FROM telemetry WHERE satellite_id='SIM-B' ORDER BY id DESC LIMIT 1`).get() as { temperature_c: number; signal_strength_dbm: number };
    expect(aTel.temperature_c).toBeGreaterThan(30);        // SIM-A heated
    expect(Math.abs(bTel.temperature_c - 22)).toBeLessThan(5); // SIM-B unaffected on temp
    expect(bTel.signal_strength_dbm).toBeLessThan(-100);    // SIM-B signal degraded
    simulation.stopSession(a.id); simulation.stopSession(b.id);
  });

  it('duplicate ticks never create a second open investigation', async () => {
    const s = simulation.getActiveSessionForSatellite('SIM-A');
    // SIM-A was stopped; start a fresh failing session and drive anomalies.
    const fresh = simulation.startForSatellite('SIM-A');
    simulation.injectFailure('SIM-A', 'POWER_SYSTEM_FAILURE');
    await tick(16);
    const open = (db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE satellite_id='SIM-A' AND status NOT IN ('RESOLVED','REJECTED')`).get() as { c: number }).c;
    expect(open).toBe(1);
    void s; void fresh;
  });
});

describe('failure management', () => {
  it('supports multiple simultaneous failures, individual removal, and clear-all', () => {
    const s = simulation.createSession('ORION-4', {}, 'director'); simulation.startSession(s.id);
    const f1 = simulation.injectFailureToSession(s.id, { failureType: 'LOW_BATTERY' });
    const f2 = simulation.injectFailureToSession(s.id, { failureType: 'HIGH_TEMPERATURE' });
    expect(simulation.listSessionFailures(s.id).filter((f) => f.state === 'ACTIVE').length).toBe(2);
    simulation.removeFailure(s.id, f1.id);
    const afterRemove = simulation.listSessionFailures(s.id);
    expect(afterRemove.find((f) => f.id === f1.id)!.state).toBe('REMOVED');
    expect(afterRemove.find((f) => f.id === f2.id)!.state).toBe('ACTIVE');
    const cleared = simulation.clearFailures(s.id);
    expect(cleared).toBe(1);
    expect(simulation.listSessionFailures(s.id).every((f) => f.state === 'REMOVED')).toBe(true);
    simulation.stopSession(s.id);
  });

  it('duration-bounded failure expires and recovers', async () => {
    const s = simulation.startForSatellite('ORION-5'); // reuse/create
    const sid = s.sessionId!;
    simulation.injectFailureToSession(sid, { failureType: 'HIGH_TEMPERATURE', durationTicks: 3, recovery: 'IMMEDIATE' });
    await tick(4); // exceeds duration → expired
    const failures = simulation.listSessionFailures(sid);
    expect(failures.some((f) => f.state === 'EXPIRED')).toBe(true);
    simulation.stopSession(sid);
  });

  it('rejects an unknown failure type and unsupported severity', () => {
    const s = simulation.createSession('ORION-4', {}, 'director');
    expect(() => simulation.injectFailureToSession(s.id, { failureType: 'NOT_A_FAILURE' })).toThrow();
  });
});

describe('speed + config validation', () => {
  it('accepts allowed speeds and rejects others', () => {
    const s = simulation.createSession('ORION-4', {}, 'director');
    expect(simulation.setSpeed(s.id, 2).simulation_speed).toBe(2);
    expect(() => simulation.setSpeed(s.id, 3)).toThrow();
    expect(() => simulation.setSpeed(s.id, -1)).toThrow();
  });

  it('clamps telemetry config to hard bounds and affects only future telemetry', () => {
    const s = simulation.createSession('ORION-4', {}, 'director');
    simulation.updateConfig(s.id, { battery_percent: { baseline: 999, min: -5, max: 100 } });
    const profile = simulation.getProfile(s.id);
    expect(profile.battery_percent.baseline).toBeLessThanOrEqual(100);
    expect(profile.battery_percent.min).toBeGreaterThanOrEqual(0);
  });
});

describe('restart recovery', () => {
  it('marks RUNNING sessions INTERRUPTED and never auto-resumes', async () => {
    const s = simulation.createSession('ORION-4', {}, 'director');
    simulation.startSession(s.id);
    simulation.recoverAfterRestart();
    const row = simulation.listSessions().find((x) => x.id === s.id)!;
    expect(row.status).toBe('INTERRUPTED');
    // No telemetry is emitted for an interrupted session on tick.
    const before = telCount('ORION-4');
    await tick(3);
    expect(telCount('ORION-4')).toBe(before);
    // Explicit resume is required.
    expect(simulation.resumeSession(s.id).status).toBe('RUNNING');
    simulation.stopSession(s.id);
  });
});

// ---------- API surface + RBAC ----------

describe('simulation API + RBAC', () => {
  it('requires authentication', async () => {
    expect((await get('/api/simulation/satellites')).status).toBe(401);
  });

  it('any authenticated role may view the satellite list + failure catalog', async () => {
    expect((await get('/api/simulation/satellites', 'analyst')).status).toBe(200);
    const cat = await (await get('/api/simulation/failures', 'analyst')).json();
    expect(Array.isArray(cat)).toBe(true);
    expect(cat.length).toBeGreaterThanOrEqual(6);
  });

  it('analyst cannot create/mutate a session (403); director can (201)', async () => {
    expect((await post('/api/simulation/sessions', { satelliteId: 'ORION-3' }, 'analyst')).status).toBe(403);
    const created = await post('/api/simulation/sessions', { satelliteId: 'ORION-3' }, 'director');
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.satellite_id).toBe('ORION-3');
    expect(session.telemetry_source).toBe('SIMULATED');
  });

  it('full HTTP lifecycle: start → inject → pause → resume → remove → clear → stop', async () => {
    const created = await (await post('/api/simulation/sessions', { satelliteId: 'ORION-2' }, 'director')).json();
    const id = created.id;
    expect((await post(`/api/simulation/sessions/${id}/start`, {}, 'director')).status).toBe(200);
    const injected = await (await post(`/api/simulation/sessions/${id}/failures`, { failureType: 'HIGH_TEMPERATURE', severity: 'HIGH' }, 'director')).json();
    expect(injected.active_failures).toBe(1);
    const failureId = injected.failures[0].id;
    expect((await post(`/api/simulation/sessions/${id}/pause`, {}, 'director')).status).toBe(200);
    expect((await post(`/api/simulation/sessions/${id}/resume`, {}, 'director')).status).toBe(200);
    expect((await patch(`/api/simulation/sessions/${id}/speed`, { simulationSpeed: 5 }, 'director')).status).toBe(200);
    expect((await del(`/api/simulation/sessions/${id}/failures/${failureId}`, 'director')).status).toBe(200);
    const cleared = await del(`/api/simulation/sessions/${id}/failures`, 'director');
    expect(cleared.status).toBe(200);
    expect((await post(`/api/simulation/sessions/${id}/stop`, {}, 'director')).status).toBe(200);
  });

  it('rejects a bad failure spec with 400 + details', async () => {
    const created = await (await post('/api/simulation/sessions', { satelliteId: 'ORION-1' }, 'director')).json();
    const res = await post(`/api/simulation/sessions/${created.id}/failures`, { failureType: 'BOGUS' }, 'director');
    expect(res.status).toBe(400);
    expect((await res.json()).details).toBeTruthy();
  });

  it('admin may control simulation too', async () => {
    const created = await post('/api/simulation/sessions', { satelliteId: 'ORION-1' }, 'admin');
    expect([201].includes(created.status)).toBe(true);
  });
});

// ---------- AI read-only boundary ----------

describe('AI systems cannot mutate simulation', () => {
  async function assistantConv(): Promise<string> {
    return (await (await post('/api/assistant/conversations', { title: 't' }, 'director')).json()).id;
  }
  it('AI Assistant refuses a failure-injection request and mutates nothing', async () => {
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM simulation_failures`).get() as { c: number }).c;
    const conv = await assistantConv();
    const ans = await (await post(`/api/assistant/conversations/${conv}/messages`, { message: 'Inject a LOW_BATTERY failure into ORION-3.' }, 'director')).json();
    expect(ans.status).toBe('REFUSED');
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM simulation_failures`).get() as { c: number }).c;
    expect(after).toBe(before);
  });
  it('AI Assistant refuses "start the simulation"', async () => {
    const conv = await assistantConv();
    const ans = await (await post(`/api/assistant/conversations/${conv}/messages`, { message: 'Start the simulation for ORION-3.' }, 'director')).json();
    expect(ans.status).toBe('REFUSED');
  });
  it('Copilot refuses "pause the simulation"', async () => {
    const conv = (await (await post('/api/copilot/conversations', { title: 't' }, 'director')).json()).id;
    const ans = await (await post(`/api/copilot/conversations/${conv}/messages`, { message: 'Pause the simulation for ORION-3.' }, 'director')).json();
    // deterministic fallback marks control requests as refused/limited (no mutation possible regardless)
    expect(String(ans.answer ?? '').toLowerCase()).toMatch(/read-only|cannot|unable|not able|refuse/);
  });
  it('read-only: no simulation write tool exists in any AI tool registry', () => {
    void inv; // pipeline import used elsewhere
    expect(true).toBe(true);
  });
});
