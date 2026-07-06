/**
 * Reusable citation validation (Phase 4). Deterministic + bounded.
 *
 * Every generated citation ID must: be syntactically valid, be present in the
 * generation context (the allowed set for THIS investigation), and resolve to a
 * real stored chunk. Fabricated, malformed, or out-of-context citations fail.
 */
import { isValidCitationId } from '../knowledge/citations.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import type { CitationValidationResult, GeneratedBriefing, GroundedGenerationContext } from './types.js';

/** Collect every citation ID referenced anywhere in the briefing. */
export function collectCitationIds(b: GeneratedBriefing): string[] {
  const ids: string[] = [];
  for (const s of b.situation ?? []) ids.push(...(s.citation_ids ?? []));
  ids.push(...(b.root_cause?.citation_ids ?? []));
  for (const e of b.evidence_summary ?? []) ids.push(...(e.citation_ids ?? []));
  for (const r of b.recommended_review_items ?? []) ids.push(...(r.citation_ids ?? []));
  return ids;
}

export function validateCitations(b: GeneratedBriefing, ctx: GroundedGenerationContext): CitationValidationResult {
  const allowed = new Set(ctx.allowedCitationIds);
  const invalid = new Set<string>();
  const reasons: string[] = [];

  for (const id of collectCitationIds(b)) {
    if (!isValidCitationId(id)) {
      invalid.add(id);
      reasons.push(`malformed citation ID: ${id}`);
      continue;
    }
    if (!allowed.has(id)) {
      invalid.add(id);
      reasons.push(`citation not in investigation context: ${id}`);
      continue;
    }
    if (!resolveCitation(id)) {
      invalid.add(id);
      reasons.push(`citation does not resolve to a stored chunk: ${id}`);
    }
  }
  return { valid: invalid.size === 0, invalidCitationIds: [...invalid], reasons };
}
