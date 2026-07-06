import { describe, it, expect } from 'vitest';
import { evaluateViolations, DEFAULT_THRESHOLDS, anomalySeverity } from '../src/analysis/anomalyRules.js';
import type { Telemetry } from '../src/types.js';

function sample(overrides: Partial<Telemetry>): Telemetry {
  return {
    id: 0,
    satellite_id: 'ORION-3',
    timestamp: new Date().toISOString(),
    temperature_c: 22,
    battery_percent: 90,
    signal_strength_dbm: -95,
    power_consumption_w: 600,
    altitude_km: 545,
    velocity_kms: 7.6,
    latitude: 0,
    longitude: 0,
    ...overrides,
  };
}

const BASELINE_ALT = 545;

describe('evaluateViolations', () => {
  it('returns no violations for nominal telemetry', () => {
    const window = [sample({}), sample({}), sample({}), sample({})];
    expect(evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT)).toHaveLength(0);
  });

  it('detects LOW_BATTERY when persisted across samples', () => {
    const window = [sample({ battery_percent: 20 }), sample({ battery_percent: 18 }), sample({ battery_percent: 15 })];
    const v = evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT);
    expect(v.map((x) => x.anomaly_type)).toContain('LOW_BATTERY');
  });

  it('does NOT fire LOW_BATTERY on a single transient dip (persistence guard)', () => {
    const window = [sample({ battery_percent: 90 }), sample({ battery_percent: 90 }), sample({ battery_percent: 15 })];
    const v = evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT);
    expect(v.map((x) => x.anomaly_type)).not.toContain('LOW_BATTERY');
  });

  it('detects HIGH_TEMPERATURE', () => {
    const window = [sample({ temperature_c: 80 }), sample({ temperature_c: 82 }), sample({ temperature_c: 85 })];
    expect(evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT).map((x) => x.anomaly_type)).toContain('HIGH_TEMPERATURE');
  });

  it('detects COMMUNICATION_LOSS', () => {
    const window = [sample({ signal_strength_dbm: -112 }), sample({ signal_strength_dbm: -115 }), sample({ signal_strength_dbm: -120 })];
    expect(evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT).map((x) => x.anomaly_type)).toContain('COMMUNICATION_LOSS');
  });

  it('detects ABNORMAL_POWER_CONSUMPTION', () => {
    const window = [sample({ power_consumption_w: 900 }), sample({ power_consumption_w: 950 }), sample({ power_consumption_w: 1000 })];
    expect(evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT).map((x) => x.anomaly_type)).toContain('ABNORMAL_POWER_CONSUMPTION');
  });

  it('detects ORBIT_DEVIATION beyond tolerance', () => {
    const window = [sample({ altitude_km: 600 }), sample({ altitude_km: 610 }), sample({ altitude_km: 620 })];
    expect(evaluateViolations(window, DEFAULT_THRESHOLDS, BASELINE_ALT).map((x) => x.anomaly_type)).toContain('ORBIT_DEVIATION');
  });
});

describe('anomalySeverity', () => {
  it('rates a deep battery drop more severe than a shallow one', () => {
    const shallow = anomalySeverity('LOW_BATTERY', 24, 25);
    const deep = anomalySeverity('LOW_BATTERY', 5, 25);
    const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    expect(order.indexOf(deep)).toBeGreaterThan(order.indexOf(shallow));
  });
});
