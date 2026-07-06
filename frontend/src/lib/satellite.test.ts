import { describe, it, expect } from 'vitest';
import { satelliteHasTelemetry, healthLabel, orbitAvailable, altitudeLabel, isSimulatable, isArchived, isManual } from './satellite';
import type { Satellite } from '../types';

const base: Satellite = {
  id: 'X', name: 'X', norad_id: '', mission: 'm', orbit_type: 'UNKNOWN',
  altitude: 0, velocity: 0, latitude: 0, longitude: 0, health_score: 0, status: 'UNKNOWN',
};

describe('dynamic satellite honest-state helpers', () => {
  it('a freshly registered (no-telemetry) satellite never shows a fabricated health %', () => {
    const s = { ...base, status: 'UNKNOWN' as const, data_source_mode: 'NO_TELEMETRY' as const };
    expect(satelliteHasTelemetry(s)).toBe(false);
    expect(healthLabel(s)).toBe('no telemetry');
  });
  it('a satellite with telemetry shows its health %', () => {
    const s = { ...base, status: 'HEALTHY' as const, data_source_mode: 'SIMULATED' as const, health_score: 92.4 };
    expect(satelliteHasTelemetry(s)).toBe(true);
    expect(healthLabel(s)).toBe('92%');
  });
  it('never shows a fabricated altitude when orbit data is unavailable', () => {
    const s = { ...base, orbit_data_state: 'UNAVAILABLE' as const, altitude: 0 };
    expect(orbitAvailable(s)).toBe(false);
    expect(altitudeLabel(s)).toBe('orbit data unavailable');
  });
  it('shows altitude when orbit data was provided', () => {
    const s = { ...base, orbit_data_state: 'MANUALLY_PROVIDED' as const, altitude: 550 };
    expect(orbitAvailable(s)).toBe(true);
    expect(altitudeLabel(s)).toBe('550 km');
  });
  it('simulation eligibility respects lifecycle + sim flag', () => {
    expect(isSimulatable({ lifecycle_state: 'ACTIVE', sim_eligible: 1 })).toBe(true);
    expect(isSimulatable({ lifecycle_state: 'ARCHIVED', sim_eligible: 1 })).toBe(false);
    expect(isSimulatable({ lifecycle_state: 'ACTIVE', sim_eligible: 0 })).toBe(false);
  });
  it('archived + manual flags', () => {
    expect(isArchived({ lifecycle_state: 'ARCHIVED' })).toBe(true);
    expect(isArchived({ lifecycle_state: 'ACTIVE' })).toBe(false);
    expect(isManual({ origin: 'MANUAL' })).toBe(true);
    expect(isManual({ origin: 'SEED' })).toBe(false);
  });
  it('backward-compat: older rows with no dynamic fields behave as telemetry-bearing/plottable', () => {
    const legacy = { ...base, status: 'HEALTHY' as const, health_score: 80, altitude: 600, data_source_mode: undefined, orbit_data_state: undefined };
    expect(satelliteHasTelemetry(legacy)).toBe(true);
    expect(orbitAvailable(legacy)).toBe(true);
  });
});
