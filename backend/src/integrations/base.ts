/**
 * Base helpers shared by all external-data adapters.
 *
 * Every adapter is OFFLINE_FIXTURE by default. Live mode is optional and
 * disabled unless explicitly enabled via config. If live mode is enabled and a
 * call fails, adapters fall back to the bundled fixture and set fallback_used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { IntegrationMode, Provenance } from '../types.js';

export function loadFixture<T = unknown>(fileName: string): T {
  const file = path.join(config.fixturesDir, fileName);
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as T;
}

export interface AdapterFetchResult<T> {
  data: T;
  provenance: Provenance;
}

/** Build a provenance record for a fixture read. */
export function fixtureProvenance(
  sourceName: string,
  sourceUrl: string,
  cached: boolean,
  fallbackUsed = false,
): Provenance {
  return {
    source_name: sourceName,
    source_url: sourceUrl,
    retrieved_at: new Date().toISOString(),
    mode: 'OFFLINE_FIXTURE' as IntegrationMode,
    cached,
    fallback_used: fallbackUsed,
  };
}

/**
 * Optional live fetch with timeout. Only invoked when integration mode is
 * LIVE_API (disabled by default). Uses global fetch (Node 18+). Never called
 * during the offline demo.
 */
export async function liveFetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.liveApiTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function isLiveMode(): boolean {
  return config.integrationMode === 'LIVE_API';
}
