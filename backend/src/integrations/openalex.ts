/**
 * OpenAlex adapter — scientific reference context for reports.
 * NOT on the critical investigation path; used during report generation.
 * OFFLINE_FIXTURE by default.
 */
import { fixtureProvenance, isLiveMode, liveFetchJson, loadFixture } from './base.js';
import { integrationCache } from './cache.js';
import type { Provenance, RootCause } from '../types.js';

const SOURCE_NAME = 'OpenAlex';
const SOURCE_URL = 'https://api.openalex.org/works';
const CACHE_KEY = 'openalex:works';

export interface ResearchReference {
  id: string;
  title: string;
  publication_year: number;
  host_venue: string;
  topic: string;
}

export interface ResearchResult {
  references: ResearchReference[];
  provenance: Provenance;
}

export async function getReferencesFor(rootCause: RootCause): Promise<ResearchResult> {
  let fallbackUsed = false;
  const cacheKey = `${CACHE_KEY}:${rootCause}`;
  const cached = integrationCache.get<ResearchResult>(cacheKey);
  if (cached) return { ...cached, provenance: { ...cached.provenance, cached: true } };

  if (isLiveMode()) {
    try {
      await liveFetchJson(`${SOURCE_URL}?search=${encodeURIComponent(rootCause)}`);
      fallbackUsed = true; // MVP normalizes from fixture for determinism
    } catch {
      fallbackUsed = true;
    }
  }

  const raw = loadFixture<any>('openalex_research.json');
  const all: ResearchReference[] = raw.works ?? [];
  // Prefer topic-matched references, then fill with general ones.
  const matched = all.filter((w) => w.topic === rootCause);
  const others = all.filter((w) => w.topic !== rootCause);
  const references = [...matched, ...others].slice(0, 3);

  const result: ResearchResult = {
    references,
    provenance: fixtureProvenance(SOURCE_NAME, SOURCE_URL, false, fallbackUsed),
  };
  integrationCache.set(cacheKey, result);
  return result;
}
