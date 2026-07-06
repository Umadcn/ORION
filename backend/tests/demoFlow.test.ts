/**
 * End-to-end simulation pipeline at the service level (offline, in-memory DB).
 *
 * Session-based (no demo launcher, no destructive reset): create/start a session
 * for an explicitly-selected satellite, inject a failure, and verify the full
 * existing pipeline runs — anomaly → alert → investigation → 6 agents → RCA →
 * human review → report. Also verifies STOP is non-destructive.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema, db } from '../src/db.js';
import { initSimulation, simulation } from '../src/services/simulationService.js';
import * as inv from '../src/services/investigationService.js';
import { generateReport } from '../src/services/reportService.js';
import type { Investigation } from '../src/types.js';

beforeAll(() => {
  initSchema();
  initSimulation();
});

async function tick(n: number) {
  for (let i = 0; i < n; i++) await simulation.tickOnce();
}
const telemetryCount = (id: string) =>
  (db.prepare('SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id=?').get(id) as { c: number }).c;

describe('session-based simulation pipeline', () => {
  it('runs the full ORION-3 power failure investigation offline', async () => {
    simulation.injectFailure('ORION-3', 'POWER_SYSTEM_FAILURE');
    await tick(16);

    const investigation = inv.findOpenInvestigation('ORION-3');
    expect(investigation, 'an investigation should be auto-created for ORION-3').toBeTruthy();
    const inv3 = investigation as Investigation;

    const alerts = inv.getInvestigationAlerts(inv3.id);
    expect(alerts.length).toBeGreaterThan(0);
    const alertTypes = alerts.map((a) => a.anomaly_type);
    expect(alertTypes).toContain('LOW_BATTERY');
    expect(alertTypes).toContain('ABNORMAL_POWER_CONSUMPTION');

    const execs = inv.getAgentExecutions(inv3.id);
    const agentIds = new Set(execs.map((e) => e.agent_id));
    for (const id of ['telemetry-monitoring', 'anomaly-detection', 'space-weather', 'orbit-intelligence', 'root-cause-analysis']) {
      expect(agentIds.has(id), `agent ${id} should have executed`).toBe(true);
    }

    const detail = inv.requireInvestigation(inv3.id);
    expect(detail.root_cause).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(detail.status).toBe('WAITING_FOR_REVIEW');
    expect((detail.confidence ?? 0)).toBeGreaterThanOrEqual(0.8);
    expect(['HIGH', 'CRITICAL']).toContain(detail.severity!);

    const evidence = inv.getEvidence(inv3.id);
    expect(evidence.some((e) => e.source_type === 'SPACE_WEATHER')).toBe(true);
    expect(evidence.some((e) => e.source_type === 'ORBIT_DATA')).toBe(true);

    expect(inv.getRecommendations(inv3.id).length).toBeGreaterThan(0);

    // Human-in-the-loop: cannot resolve before approval.
    expect(() => inv.resolve(inv3.id)).toThrow();
    expect(inv.approve(inv3.id).status).toBe('APPROVED');
    expect(inv.resolve(inv3.id).status).toBe('RESOLVED');

    const report = await generateReport(inv3.id);
    expect(report.id).toBeGreaterThan(0);
    const content = JSON.parse(report.content);
    expect(content.root_cause).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(content.safety_statement).toMatch(/SIMULATION/i);
    expect(inv.getAgentExecutions(inv3.id).some((e) => e.agent_id === 'report-generation')).toBe(true);
  });

  it('does not create duplicate investigations while one is open', async () => {
    simulation.injectFailure('ORION-1', 'POWER_SYSTEM_FAILURE');
    await tick(14);
    const open = () =>
      (db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE satellite_id='ORION-1' AND status NOT IN ('RESOLVED','REJECTED')`).get() as { c: number }).c;
    expect(open()).toBe(1);
    await tick(6);
    expect(open()).toBe(1);
  });

  it('STOP is non-destructive: no new telemetry, history preserved', async () => {
    simulation.injectFailure('ORION-2', 'THERMAL_CONTROL_FAILURE');
    await tick(12);
    const session = simulation.getActiveSessionForSatellite('ORION-2')!;
    const telemetryBefore = telemetryCount('ORION-2');
    const alertsBefore = (db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE satellite_id='ORION-2'`).get() as { c: number }).c;

    simulation.stopSession(session.id);
    await tick(5); // a stopped session must not emit telemetry

    expect(telemetryCount('ORION-2')).toBe(telemetryBefore);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE satellite_id='ORION-2'`).get() as { c: number }).c).toBe(alertsBefore);
    // Failure history is preserved (marked in DB), not deleted.
    expect((db.prepare(`SELECT COUNT(*) AS c FROM simulation_failures WHERE session_id=?`).get(session.id) as { c: number }).c).toBeGreaterThan(0);
  });
});
