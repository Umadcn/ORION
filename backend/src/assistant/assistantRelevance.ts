/**
 * Deterministic post-retrieval relevance gate + identifier-aware filtering
 * (Phase 10 correctness repair).
 *
 * Retrieval no longer returns raw top-K. Each candidate passage is scored for
 * relevance to the (intent-aware) query and classified ACCEPTED / WEAK / REJECTED:
 *   - ACCEPTED   → may support a factual answer + citation.
 *   - WEAK       → may trigger a bounded query refinement, never a citation.
 *   - REJECTED   → never appears as an answer source / citation.
 * A passage that mentions a DIFFERENT satellite id than the resolved entity is
 * rejected on identifier conflict (unless the route explicitly allows it, e.g.
 * historical / comparison). If nothing is ACCEPTED, the caller abstains.
 *
 * Thresholds are bounded constants (documented in AI_ASSISTANT_RELEVANCE_AND_ABSTENTION.md).
 */
import { tokenize } from '../retrieval/tokenize.js';
import { extractSatelliteCandidates } from './intentRouter.js';

export type RelevanceStatus = 'ACCEPTED' | 'WEAK' | 'REJECTED';

export interface RetrievedPassage {
  citation_id: string;
  title?: string;
  text: string;
}

export interface ScoredPassage extends RetrievedPassage {
  status: RelevanceStatus;
  overlap: number;
  coverage: number;
  reason: string;
}

export interface RelevanceOptions {
  resolvedSatelliteId?: string | null;
  /** Allow passages about other satellites (historical / comparison routes). */
  allowIdentifierConflicts?: boolean;
  minOverlap?: number;
  minCoverage?: number;
}

// Generic question filler that carries no retrieval signal.
const FILLER = new Set([
  'what', 'whats', 'does', 'do', 'did', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'for', 'to',
  'on', 'about', 'tell', 'me', 'show', 'give', 'say', 'says', 'said', 'and', 'or', 'in', 'with', 'please',
  'can', 'you', 'i', 'we', 'have', 'has', 'any', 'this', 'that', 'it', 'its', 'how', 'why', 'when', 'where',
  'which', 'who', 'my', 'our', 'your', 'get', 'find', 'look', 'up', 'info', 'information', 'details',
]);

const DEFAULT_MIN_OVERLAP = 2;
const DEFAULT_MIN_COVERAGE = 0.15;

export function meaningfulTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(String(text ?? ''), { maxTokens: 256 })) {
    if (t.length < 3) continue;
    if (FILLER.has(t)) continue;
    out.add(t);
  }
  return out;
}

/** Classify a single passage against the query terms + resolved entity. */
export function scorePassage(queryTerms: Set<string>, passage: RetrievedPassage, opts: RelevanceOptions): ScoredPassage {
  const minOverlap = opts.minOverlap ?? DEFAULT_MIN_OVERLAP;
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const resolved = opts.resolvedSatelliteId ? opts.resolvedSatelliteId.toUpperCase() : null;

  // Identifier conflict: a passage explicitly about a DIFFERENT satellite.
  if (resolved && !opts.allowIdentifierConflicts) {
    const ids = extractSatelliteCandidates(`${passage.title ?? ''} ${passage.text}`);
    const conflicting = ids.filter((id) => id !== resolved);
    if (conflicting.length > 0 && !ids.includes(resolved)) {
      return { ...passage, status: 'REJECTED', overlap: 0, coverage: 0, reason: `IDENTIFIER_CONFLICT:${conflicting[0]}` };
    }
  }

  const passageTerms = meaningfulTerms(`${passage.title ?? ''} ${passage.text}`);
  let overlap = 0;
  for (const t of queryTerms) if (passageTerms.has(t)) overlap++;
  const coverage = queryTerms.size > 0 ? overlap / queryTerms.size : 0;

  if (overlap >= minOverlap || (overlap >= 1 && coverage >= minCoverage)) {
    return { ...passage, status: 'ACCEPTED', overlap, coverage, reason: 'RELEVANT' };
  }
  if (overlap >= 1) return { ...passage, status: 'WEAK', overlap, coverage, reason: 'WEAK_OVERLAP' };
  return { ...passage, status: 'REJECTED', overlap, coverage, reason: 'NO_OVERLAP' };
}

export interface RelevanceResult {
  accepted: ScoredPassage[];
  weak: ScoredPassage[];
  rejected: ScoredPassage[];
}

/** Apply the relevance gate to a set of retrieved passages for a query. */
export function filterRelevant(query: string, passages: RetrievedPassage[], opts: RelevanceOptions = {}): RelevanceResult {
  const queryTerms = meaningfulTerms(query);
  const scored = passages.map((p) => scorePassage(queryTerms, p, opts));
  return {
    accepted: scored.filter((p) => p.status === 'ACCEPTED'),
    weak: scored.filter((p) => p.status === 'WEAK'),
    rejected: scored.filter((p) => p.status === 'REJECTED'),
  };
}
