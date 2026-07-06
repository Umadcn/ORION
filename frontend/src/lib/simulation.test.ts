import { describe, it, expect } from 'vitest';
import {
  SIM_SPEEDS, SIM_FIELDS, canControlSimulation, canStart, canPause, canResume, canStop, canInject,
  activeFailures, filterSatellites, fieldLabel, fieldUnit, formatFieldValue, hasLiveSession, sessionStatusColor,
} from './simulation';
import type { SimFailure, SimSatellite, SimSession } from '../types';

const sat = (over: Partial<SimSatellite>): SimSatellite => ({
  id: 'SAT-A', name: 'Alpha', mission: 'Earth Observation', status: 'HEALTHY', orbit_type: 'LEO',
  data_source_mode: 'SIMULATED', origin: 'MANUAL', session_id: null, session_status: null,
  telemetry_sample_count: 0, active_alerts: 0, open_investigations: 0, ...over,
});

const failure = (over: Partial<SimFailure>): SimFailure => ({
  id: 'f1', failure_type: 'LOW_BATTERY', display_name: 'Low Battery', severity: 'MEDIUM',
  onset: 'IMMEDIATE', recovery: 'IMMEDIATE', duration_ticks: null, remaining_ticks: null, onset_ticks: 4,
  state: 'ACTIVE', injected_at_tick: 0, expired_at_tick: null, affected_fields: ['battery_percent'],
  expected_alert_types: ['LOW_BATTERY'], ...over,
});

describe('simulation control-center helpers', () => {
  it('exposes bounded speed options and the real telemetry fields', () => {
    expect(SIM_SPEEDS).toEqual([0.5, 1, 2, 5, 10]);
    expect(SIM_FIELDS.map((f) => f.key)).toEqual(['battery_percent', 'temperature_c', 'power_consumption_w', 'signal_strength_dbm', 'altitude_km']);
  });

  it('RBAC: only Director/Admin can control simulation', () => {
    expect(canControlSimulation('MISSION_DIRECTOR')).toBe(true);
    expect(canControlSimulation('SYSTEM_ADMIN')).toBe(true);
    expect(canControlSimulation('MISSION_ANALYST')).toBe(false);
    expect(canControlSimulation(null)).toBe(false);
  });

  it('lifecycle transitions gate the right controls per status', () => {
    expect(canStart('CREATED')).toBe(true);
    expect(canStart('RUNNING')).toBe(false);
    expect(canPause('RUNNING')).toBe(true);
    expect(canPause('PAUSED')).toBe(false);
    expect(canResume('PAUSED')).toBe(true);
    expect(canResume('INTERRUPTED')).toBe(true);
    expect(canStop('RUNNING')).toBe(true);
    expect(canStop('STOPPED')).toBe(false);
    expect(canInject('RUNNING')).toBe(true);
    expect(canInject('STOPPED')).toBe(false);
    // An interrupted session (post-restart) can be resumed but not paused.
    expect(canResume('INTERRUPTED')).toBe(true);
    expect(canPause('INTERRUPTED')).toBe(false);
  });

  it('activeFailures ignores removed/expired failures', () => {
    const session = { failures: [failure({ id: 'a' }), failure({ id: 'b', state: 'REMOVED' }), failure({ id: 'c', state: 'EXPIRED' })] } as SimSession;
    expect(activeFailures(session).map((f) => f.id)).toEqual(['a']);
    expect(activeFailures(null)).toEqual([]);
  });

  it('satellite selector filters by id/name/mission/status', () => {
    const sats = [sat({ id: 'SAT-A', name: 'Alpha', mission: 'Weather' }), sat({ id: 'ORION-2', name: 'Bravo', mission: 'Comms', status: 'WARNING' })];
    expect(filterSatellites(sats, 'orion').map((s) => s.id)).toEqual(['ORION-2']);
    expect(filterSatellites(sats, 'weather').map((s) => s.id)).toEqual(['SAT-A']);
    expect(filterSatellites(sats, 'warning').map((s) => s.id)).toEqual(['ORION-2']);
    expect(filterSatellites(sats, '').length).toBe(2);
  });

  it('field formatting uses the real units', () => {
    expect(fieldLabel('battery_percent')).toBe('Battery');
    expect(fieldUnit('signal_strength_dbm')).toBe('dBm');
    expect(formatFieldValue('battery_percent', 92.345)).toBe('92.35 %');
    expect(formatFieldValue('temperature_c', 25)).toBe('25 °C');
  });

  it('hasLiveSession recognizes non-terminal sessions only', () => {
    expect(hasLiveSession(sat({ session_status: 'RUNNING' }))).toBe(true);
    expect(hasLiveSession(sat({ session_status: 'PAUSED' }))).toBe(true);
    expect(hasLiveSession(sat({ session_status: 'STOPPED' }))).toBe(false);
    expect(hasLiveSession(sat({ session_status: null }))).toBe(false);
  });

  it('status colors are defined for every state', () => {
    for (const st of ['CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'INTERRUPTED', 'FAILED'] as const) {
      expect(sessionStatusColor(st)).toMatch(/text-/);
    }
  });
});
