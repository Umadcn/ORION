import { describe, it, expect } from 'vitest';
import { getSpaceWeather } from '../src/integrations/noaaSwpc.js';
import { getAllOrbits, getOrbitFor } from '../src/integrations/celestrak.js';
import { getReferencesFor } from '../src/integrations/openalex.js';

describe('offline integration adapters', () => {
  it('NOAA SWPC loads offline fixture with provenance and no fallback', async () => {
    const sw = await getSpaceWeather();
    expect(sw.provenance.mode).toBe('OFFLINE_FIXTURE');
    expect(sw.provenance.fallback_used).toBe(false);
    expect(sw.kp_index).toBeTypeOf('number');
    expect(sw.geomagnetic_condition).toBe('QUIET');
  });

  it('CelesTrak returns orbital data for all seeded satellites', async () => {
    const orbits = await getAllOrbits();
    expect(orbits.length).toBeGreaterThanOrEqual(5);
    const o3 = await getOrbitFor('ORION-3');
    expect(o3?.norad_id).toBe('90003');
    expect(o3?.provenance.mode).toBe('OFFLINE_FIXTURE');
  });

  it('OpenAlex returns topic-matched references for a root cause', async () => {
    const res = await getReferencesFor('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(res.references.length).toBeGreaterThan(0);
    expect(res.references[0].topic).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(res.provenance.mode).toBe('OFFLINE_FIXTURE');
  });
});
