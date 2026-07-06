import { describe, it, expect } from 'vitest';
import {
  altitudeKmToSceneRadius, buildPlottedSatellite, orbitCategoryOf, orbitPathPoints,
  passesOrbitFilter, selectPlotted, EARTH_RADIUS, latLonToUnitVector,
} from './orbitMath';
import { effectiveStatusOf, statusColorHex, passesStatusFilter } from './orbitStatus';
import type { Satellite } from '../../types';

const sat = (over: Partial<Satellite> = {}): Satellite => ({
  id: 'SAT-X', name: 'SAT-X', norad_id: '1', mission: 'm', orbit_type: 'LEO',
  altitude: 550, velocity: 7.6, latitude: 0, longitude: 0, health_score: 90,
  status: 'HEALTHY', orbit_data_state: 'MANUALLY_PROVIDED', data_source_mode: 'SIMULATED',
  lifecycle_state: 'ACTIVE', ...over,
});
const mag = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

describe('altitudeKmToSceneRadius', () => {
  it('is monotonic non-decreasing in altitude', () => {
    let prev = -Infinity;
    for (const a of [0, 100, 550, 2000, 8000, 20200, 35786, 100000]) {
      const r = altitudeKmToSceneRadius(a);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
  it('keeps every satellite above the Earth surface and bounded', () => {
    for (const a of [1, 550, 20200, 35786, 500000]) {
      const r = altitudeKmToSceneRadius(a);
      expect(r).toBeGreaterThan(EARTH_RADIUS);
      expect(r).toBeLessThanOrEqual(4.2);
    }
  });
  it('preserves LEO < MEO < GEO ordering', () => {
    const leo = altitudeKmToSceneRadius(550);
    const meo = altitudeKmToSceneRadius(20200);
    const geo = altitudeKmToSceneRadius(35786);
    expect(leo).toBeLessThan(meo);
    expect(meo).toBeLessThan(geo);
  });
});

describe('orbitCategoryOf', () => {
  it('maps types and infers OTHER/UNKNOWN from altitude', () => {
    expect(orbitCategoryOf({ orbit_type: 'LEO', altitude: 550 })).toBe('LEO');
    expect(orbitCategoryOf({ orbit_type: 'SSO', altitude: 700 })).toBe('LEO');
    expect(orbitCategoryOf({ orbit_type: 'MEO', altitude: 20200 })).toBe('MEO');
    expect(orbitCategoryOf({ orbit_type: 'GEO', altitude: 35786 })).toBe('GEO');
    expect(orbitCategoryOf({ orbit_type: 'HEO', altitude: 30000 })).toBe('HEO');
    expect(orbitCategoryOf({ orbit_type: 'UNKNOWN', altitude: 800 })).toBe('LEO');
    expect(orbitCategoryOf({ orbit_type: 'OTHER', altitude: 36000 })).toBe('GEO');
  });
});

describe('buildPlottedSatellite — deterministic + stable', () => {
  it('same id → identical position across calls (stable across refresh)', () => {
    const s = sat({ id: 'ORBIT-DET-1', data_source_mode: 'NO_TELEMETRY', orbit_data_state: 'MANUALLY_PROVIDED', altitude: 800 });
    const a = buildPlottedSatellite(s)!;
    const b = buildPlottedSatellite({ ...s })!;
    expect(a.position).toEqual(b.position);
    expect(a.positionMode).toBe('DETERMINISTIC_VISUALIZATION');
  });
  it('different ids do not all overlap', () => {
    const ids = ['A-1', 'B-2', 'C-3', 'D-4', 'E-5'].map((id) =>
      buildPlottedSatellite(sat({ id, data_source_mode: 'NO_TELEMETRY' }))!.position.map((n) => n.toFixed(3)).join(','));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('marker sits on its own orbit radius', () => {
    const p = buildPlottedSatellite(sat({ id: 'R-1', altitude: 20200, orbit_type: 'MEO', data_source_mode: 'NO_TELEMETRY' }))!;
    expect(mag(p.position)).toBeCloseTo(p.sceneRadius, 5);
    for (const pt of orbitPathPoints(p, 32)) expect(mag(pt)).toBeCloseTo(p.sceneRadius, 5);
  });
  it('uses the real sub-satellite point when telemetry lat/lon exist (LAT_LON_ALT)', () => {
    const p = buildPlottedSatellite(sat({ id: 'LL-1', latitude: 40, longitude: -75, data_source_mode: 'SIMULATED' }))!;
    expect(p.positionMode).toBe('LAT_LON_ALT');
    // marker direction ≈ latLon(40,-75)
    const want = latLonToUnitVector(40, -75).map((n) => n * p.sceneRadius);
    for (let i = 0; i < 3; i++) expect(p.position[i]).toBeCloseTo(want[i], 2);
  });
  it('returns null when orbit data is unavailable', () => {
    expect(buildPlottedSatellite(sat({ orbit_data_state: 'UNAVAILABLE' }))).toBeNull();
    expect(buildPlottedSatellite(sat({ altitude: 0 }))).toBeNull();
  });
});

describe('effectiveStatus + colors', () => {
  it('color mapping', () => {
    expect(statusColorHex('HEALTHY')).toBe('#22c55e');
    expect(statusColorHex('WARNING')).toBe('#f59e0b');
    expect(statusColorHex('ALERT')).toBe('#ef4444');
    expect(statusColorHex('UNKNOWN')).toBe('#94a3b8');
  });
  it('manual override uses effective_status, not derived', () => {
    const s = sat({ status: 'ALERT', effective_status: 'ALERT', derived_status: 'HEALTHY', status_mode: 'MANUAL', manual_status: 'ALERT' });
    expect(effectiveStatusOf(s)).toBe('ALERT');
    expect(buildPlottedSatellite(s)!.status).toBe('ALERT');
  });
});

describe('filters', () => {
  it('status filter uses effective status', () => {
    const s = sat({ status: 'WARNING', effective_status: 'WARNING' });
    expect(passesStatusFilter(s, 'ALL')).toBe(true);
    expect(passesStatusFilter(s, 'WARNING')).toBe(true);
    expect(passesStatusFilter(s, 'ALERT')).toBe(false);
  });
  it('orbit filter', () => {
    expect(passesOrbitFilter('LEO', 'ALL')).toBe(true);
    expect(passesOrbitFilter('LEO', 'LEO')).toBe(true);
    expect(passesOrbitFilter('MEO', 'LEO')).toBe(false);
  });
  it('combined status + orbit filter via selectPlotted', () => {
    const sats = [
      sat({ id: 'L-H', orbit_type: 'LEO', altitude: 500, status: 'HEALTHY', effective_status: 'HEALTHY' }),
      sat({ id: 'L-A', orbit_type: 'LEO', altitude: 500, status: 'ALERT', effective_status: 'ALERT' }),
      sat({ id: 'M-A', orbit_type: 'MEO', altitude: 20000, status: 'ALERT', effective_status: 'ALERT' }),
      sat({ id: 'NO-ORBIT', orbit_data_state: 'UNAVAILABLE', altitude: 0 }),
      sat({ id: 'ARCH', lifecycle_state: 'ARCHIVED' }),
    ];
    const sel = selectPlotted(sats, 'ALERT', 'LEO');
    expect(sel.plotted.map((p) => p.id)).toEqual(['L-A']); // only ALERT + LEO
    expect(sel.total).toBe(4);            // archived excluded
    expect(sel.withoutOrbitData).toBe(1); // NO-ORBIT
    expect(sel.hiddenByFilter).toBe(2);   // L-H, M-A
  });
  it('does not depend on any hardcoded ORION id', () => {
    const sel = selectPlotted([sat({ id: 'S27-ULTRA-PRO', altitude: 780, orbit_type: 'SSO', data_source_mode: 'NO_TELEMETRY' })], 'ALL', 'ALL');
    expect(sel.plotted).toHaveLength(1);
    expect(sel.plotted[0].id).toBe('S27-ULTRA-PRO');
    expect(sel.plotted[0].category).toBe('LEO');
  });
  it('handles long satellite names without transformation', () => {
    const s = sat({ id: 'S27-ULTRA-PRO-EXTENDED-NAME', name: 'S27-ULTRA-PRO-EXTENDED-NAME' });
    expect(buildPlottedSatellite(s)!.id).toBe('S27-ULTRA-PRO-EXTENDED-NAME');
  });
});
