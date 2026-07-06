/**
 * Deterministic, use-case-specific briefing fallback (Phase 4).
 *
 * Produces a schema-valid, grounded, citation-valid, evidence-valid
 * GeneratedBriefing purely from authoritative deterministic facts + retrieved
 * knowledge chunks — no fabrication, no network, no LLM. Claims are constructed
 * from cited-chunk excerpts so they carry genuine lexical grounding support.
 *
 * This is the domain fallback the GroundedGenerationService uses when the LLM
 * provider falls back (Phase 1 policy) or when a real-provider output is
 * rejected. It is always labeled through the generation status
 * (DETERMINISTIC_FALLBACK_ACCEPTED) — never as real LLM output.
 */
import { config } from '../config.js';
import { tokenize } from '../retrieval/tokenize.js';
import type { GeneratedBriefing } from '../generation/types.js';
import type { GroundedGenerationContext, GroundingSource } from '../generation/types.js';

/** Single-line excerpt of up to `n` characters, trimmed to a word boundary. */
function excerpt(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Pick the source with the most lexical overlap with the given terms. */
function bestSourceFor(terms: string[], sources: GroundingSource[]): GroundingSource {
  const want = new Set(terms.flatMap((t) => t.toLowerCase().split(/[-_\s]/)).filter(Boolean));
  let best = sources[0];
  let bestScore = -1;
  for (const s of sources) {
    const toks = new Set(tokenize(s.text, { maxTokens: 512 }));
    let score = 0;
    for (const w of want) if (toks.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function buildDeterministicBriefing(ctx: GroundedGenerationContext): GeneratedBriefing {
  const f = ctx.systemFacts;
  const sources = ctx.sources;
  const evidence = ctx.evidence;
  const maxItems = Math.min(2, config.generation.maxClaims);

  const label = f.authoritativeRootCauseLabel || 'the analyzed anomaly';

  // Situation: excerpts of the top retrieved sources (grounded by construction).
  const situation = sources.slice(0, maxItems).map((s) => ({
    claim: excerpt(s.text, 180),
    citation_ids: [s.citationId],
  }));

  // Root cause: authoritative deterministic value + a supporting excerpt.
  const rcTerms = [label, f.subsystem ?? '', ...f.anomalyTypes];
  const rcSource = bestSourceFor(rcTerms, sources);
  const root_cause = {
    authoritative_root_cause: f.authoritativeRootCause,
    explanation:
      `The authoritative deterministic root cause for ${f.satelliteId} is ${label}. ` +
      `Supporting mission reference: "${excerpt(rcSource.text, 200)}"`,
    citation_ids: [rcSource.citationId],
  };

  // Evidence summary: pair deterministic evidence with a supporting excerpt.
  const evidence_summary = evidence.slice(0, maxItems).map((e, i) => {
    const s = sources[Math.min(i, sources.length - 1)];
    return {
      claim: `Deterministic evidence notes: ${excerpt(e.text, 90)}. Supporting reference: "${excerpt(s.text, 180)}"`,
      evidence_ids: [e.evidenceId],
      citation_ids: [s.citationId],
    };
  });

  // Recommended review items: point reviewers at retrieved guidance.
  const recommended_review_items = sources.slice(0, maxItems).map((s) => ({
    item: `Review referenced mission guidance: "${excerpt(s.text, 160)}"`,
    citation_ids: [s.citationId],
  }));

  const limitations = [
    'This briefing was generated offline in deterministic fallback mode and is not real LLM output.',
    'Retrieved documents are supporting context only; the deterministic root-cause analysis remains authoritative.',
    'Grounding support is a lexical measure and is not a confidence score.',
  ];

  return {
    title: `Investigation Briefing: ${f.satelliteId} — ${label}`,
    summary:
      `Read-only briefing for investigation ${f.investigationId} on ${f.satelliteId}. ` +
      `Deterministic analysis identifies ${label} (severity ${f.severity ?? 'unknown'}). ` +
      `This summary is advisory and does not modify the investigation.`,
    situation,
    root_cause,
    evidence_summary,
    recommended_review_items,
    limitations,
  };
}
