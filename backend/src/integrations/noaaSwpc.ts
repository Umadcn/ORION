/**
 * NOAA SWPC adapter — space-weather context.
 * OFFLINE_FIXTURE by default. Normalizes fixture (or optional live) data into a
 * common shape used by the Space Weather Agent.
 */
import { fixtureProvenance, isLiveMode, liveFetchJson, loadFixture } from './base.js';
import { integrationCache } from './cache.js';
import type { Provenance } from '../types.js';

const SOURCE_NAME = 'NOAA Space Weather Prediction Center (SWPC)';
const SOURCE_URL = 'https://services.swpc.noaa.gov/';
const CACHE_KEY = 'noaa:space-weather';
const LIVE_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

export interface NormalizedSpaceWeather {
  kp_index: number;
  solar_activity: string;
  geomagnetic_condition: string; // QUIET | UNSETTLED | STORM
  solar_wind_speed_km_s: number;
  commentary: string;
  provenance: Provenance;
}

function classifyGeomagnetic(kp: number): string {
  if (kp >= 7) return 'SEVERE_STORM';
  if (kp >= 5) return 'STORM';
  if (kp >= 4) return 'UNSETTLED';
  return 'QUIET';
}

export async function getSpaceWeather(): Promise<NormalizedSpaceWeather> {
  const cached = integrationCache.get<NormalizedSpaceWeather>(CACHE_KEY);
  if (cached) {
    return { ...cached, provenance: { ...cached.provenance, cached: true } };
  }

  let fallbackUsed = false;
  let raw: any;

  if (isLiveMode()) {
    try {
      // Optional live path (disabled by default). Kept minimal + defensive.
      const kp = (await liveFetchJson(LIVE_KP_URL)) as any[];
      const latest = kp?.[kp.length - 1];
      const kpVal = Number(latest?.[1] ?? latest?.kp_index ?? 2.3);
      const result = normalize({
        planetary_k_index: [{ kp_index: kpVal }],
        solar_activity: 'unknown',
        solar_wind_speed_km_s: 0,
        commentary: 'Live NOAA data.',
      }, fixtureProvenanceLive(false));
      integrationCache.set(CACHE_KEY, result);
      return result;
    } catch {
      fallbackUsed = true; // fall through to fixture
    }
  }

  raw = loadFixture('noaa_space_weather.json');
  const result = normalize(raw, fixtureProvenance(SOURCE_NAME, SOURCE_URL, false, fallbackUsed));
  integrationCache.set(CACHE_KEY, result);
  return result;
}

function normalize(raw: any, provenance: Provenance): NormalizedSpaceWeather {
  const series = raw.planetary_k_index ?? [];
  const kp = Number(series[series.length - 1]?.kp_index ?? 2.3);
  return {
    kp_index: kp,
    solar_activity: raw.solar_activity ?? 'low',
    geomagnetic_condition: classifyGeomagnetic(kp),
    solar_wind_speed_km_s: Number(raw.solar_wind_speed_km_s ?? 0),
    commentary: raw.commentary ?? '',
    provenance,
  };
}

function fixtureProvenanceLive(fallbackUsed: boolean): Provenance {
  return {
    source_name: SOURCE_NAME,
    source_url: SOURCE_URL,
    retrieved_at: new Date().toISOString(),
    mode: 'LIVE_API',
    cached: false,
    fallback_used: fallbackUsed,
  };
}
