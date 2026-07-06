/**
 * CelesTrak adapter — orbital / TLE context.
 * OFFLINE_FIXTURE by default. Normalizes per-satellite orbital data used by the
 * Orbit Intelligence Agent.
 */
import { fixtureProvenance, isLiveMode, liveFetchJson, loadFixture } from './base.js';
import { integrationCache } from './cache.js';
import type { Provenance } from '../types.js';

const SOURCE_NAME = 'CelesTrak';
const SOURCE_URL = 'https://celestrak.org/NORAD/elements/';
const CACHE_KEY = 'celestrak:objects';

export interface NormalizedOrbit {
  object_name: string;
  norad_id: string;
  orbit_type: string;
  mean_altitude_km: number;
  inclination_deg: number;
  period_min: number;
  tle_line1: string;
  tle_line2: string;
  provenance: Provenance;
}

interface OrbitTable {
  byName: Record<string, NormalizedOrbit>;
}

async function loadTable(): Promise<OrbitTable> {
  const cached = integrationCache.get<OrbitTable>(CACHE_KEY);
  if (cached) return cached;

  let fallbackUsed = false;
  // Live mode intentionally not wired to a specific per-sat endpoint here; the
  // offline fixture is authoritative for the demo. If live were enabled and
  // failed, we would set fallbackUsed and use the fixture.
  if (isLiveMode()) {
    try {
      await liveFetchJson('https://celestrak.org/NORAD/elements/gp.php?FORMAT=json');
      // We still normalize from fixture shape for determinism in this MVP.
      fallbackUsed = true;
    } catch {
      fallbackUsed = true;
    }
  }

  const raw = loadFixture<any>('celestrak_orbit_data.json');
  const byName: Record<string, NormalizedOrbit> = {};
  for (const obj of raw.objects ?? []) {
    byName[obj.object_name] = {
      object_name: obj.object_name,
      norad_id: String(obj.norad_id),
      orbit_type: obj.orbit_type,
      mean_altitude_km: Number(obj.mean_altitude_km),
      inclination_deg: Number(obj.inclination_deg),
      period_min: Number(obj.period_min),
      tle_line1: obj.tle_line1,
      tle_line2: obj.tle_line2,
      provenance: fixtureProvenance(SOURCE_NAME, SOURCE_URL, false, fallbackUsed),
    };
  }
  const table = { byName };
  integrationCache.set(CACHE_KEY, table);
  return table;
}

export async function getOrbitFor(objectName: string): Promise<NormalizedOrbit | null> {
  const table = await loadTable();
  const found = table.byName[objectName];
  if (!found) return null;
  // Mark cached=true on repeat reads for provenance accuracy.
  return { ...found, provenance: { ...found.provenance, cached: integrationCache.has(CACHE_KEY) } };
}

export async function getAllOrbits(): Promise<NormalizedOrbit[]> {
  const table = await loadTable();
  return Object.values(table.byName);
}
