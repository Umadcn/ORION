/**
 * Claim-level grounding validation (Phase 4). Deterministic, lexical, bounded.
 *
 * For each factual generated claim this verifies MORE than "a citation array is
 * non-empty":
 *   1. the claim carries >= 1 citation ID;
 *   2. the cited chunks are present in the generation context;
 *   3. the claim's significant terms have bounded LEXICAL support in the cited
 *      chunk text (support = |claim terms found in cited chunks| / |claim terms|),
 *      compared against a configurable threshold;
 *   4. the authoritative_root_cause field EXACTLY matches the deterministic RCA.
 *
 * The support score is a lexical measure. It is NOT an LLM confidence and NOT an
 * RCA confidence. No second LLM is used as a judge.
 */
import { config } from '../config.js';
import { tokenize } from '../retrieval/tokenize.js';
import type {
  GeneratedBriefing,
  GroundedGenerationContext,
  GroundingFailureReason,
  GroundingValidationResult,
  PerClaimGrounding,
} from './types.js';

/** Expand identifier tokens into subtokens (mission-identifier aware). */
function expand(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) {
    s.add(t);
    for (const p of t.split(/[-_]/).filter(Boolean)) s.add(p);
  }
  return s;
}

/** Significant claim terms: keep tokens of length >= 3 (identifiers/numbers kept). */
function significantTerms(text: string): string[] {
  const toks = tokenize(text, { maxTokens: 256 });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of toks) {
    if (t.length < 3) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

interface ExtractedClaim {
  text: string;
  citationIds: string[];
  isRootCause: boolean;
}

function extractClaims(b: GeneratedBriefing): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const s of b.situation ?? []) claims.push({ text: s.claim, citationIds: s.citation_ids ?? [], isRootCause: false });
  if (b.root_cause) claims.push({ text: b.root_cause.explanation, citationIds: b.root_cause.citation_ids ?? [], isRootCause: true });
  for (const e of b.evidence_summary ?? []) claims.push({ text: e.claim, citationIds: e.citation_ids ?? [], isRootCause: false });
  for (const r of b.recommended_review_items ?? []) claims.push({ text: r.item, citationIds: r.citation_ids ?? [], isRootCause: false });
  // `limitations` are meta-statements about the briefing itself, not factual
  // claims about the mission, so they do not require citation grounding.
  return claims;
}

export function validateGrounding(b: GeneratedBriefing, ctx: GroundedGenerationContext): GroundingValidationResult {
  const threshold = config.generation.minGroundingSupport;
  const textById = new Map(ctx.sources.map((s) => [s.citationId, s.text]));
  const allowed = new Set(ctx.allowedCitationIds);

  const rootCauseMatches =
    (b.root_cause?.authoritative_root_cause ?? '') === ctx.systemFacts.authoritativeRootCause;

  const perClaim: PerClaimGrounding[] = [];
  for (const c of extractClaims(b)) {
    const reasons: GroundingFailureReason[] = [];
    const terms = significantTerms(c.text);

    if (c.citationIds.length === 0) reasons.push('MISSING_CITATION');
    const inContext = c.citationIds.filter((id) => allowed.has(id));
    if (c.citationIds.some((id) => !allowed.has(id))) reasons.push('CITATION_NOT_IN_CONTEXT');

    // Lexical support against the cited (in-context) chunk text.
    const citedTokens = expand(
      inContext.flatMap((id) => tokenize(textById.get(id) ?? '', { maxTokens: 4096 })),
    );
    let hit = 0;
    const termSet = expand(terms);
    for (const t of termSet) if (citedTokens.has(t)) hit++;
    const support = termSet.size > 0 ? hit / termSet.size : 0;

    if (c.isRootCause && !rootCauseMatches) reasons.push('ROOT_CAUSE_MISMATCH');
    if (inContext.length > 0 && support < threshold) reasons.push('INSUFFICIENT_LEXICAL_SUPPORT');
    if (inContext.length === 0 && c.citationIds.length > 0) reasons.push('INSUFFICIENT_LEXICAL_SUPPORT');

    const supported = reasons.length === 0;
    perClaim.push({ claim: c.text, citationIds: c.citationIds, supportScore: Number(support.toFixed(4)), supported, reasons });
  }

  const supportedClaimCount = perClaim.filter((c) => c.supported).length;
  const unsupportedClaimCount = perClaim.length - supportedClaimCount;
  const averageSupport = perClaim.length
    ? Number((perClaim.reduce((s, c) => s + c.supportScore, 0) / perClaim.length).toFixed(4))
    : null;

  return {
    valid: unsupportedClaimCount === 0 && rootCauseMatches,
    claims: perClaim,
    claimCount: perClaim.length,
    supportedClaimCount,
    unsupportedClaimCount,
    averageSupport,
    rootCauseMatches,
  };
}
