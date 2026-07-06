/**
 * Shared deterministic helpers for the Critic (Phase 7): grounding-context
 * assembly, analysis→answer mapping (for reuse of the Phase 5 grounding
 * validator), overstatement detection, and stable hashing for repeated-output
 * detection. All read-only and deterministic.
 */
import crypto from 'node:crypto';
import { createGroundingContext } from '../copilot/copilotContextBuilder.js';
import { tokenize } from '../retrieval/tokenize.js';
import type { CopilotFinalAnswer, CopilotGroundingContext } from '../copilot/types.js';
import type { PlannerAnalysis } from '../planner/types.js';
import type { CriticContext } from './types.js';

/** Absolute / certainty language that constitutes overstatement in an advisory analysis. */
export const OVERSTATEMENT_RE =
  /\b(definitely|certainly|guaranteed|guarantee|proves|proven|conclusively|undoubtedly|without a doubt|100%|absolutely|always|never fails|beyond doubt|irrefutabl)/i;

/** Map a PlannerAnalysis onto the shared copilot answer shape for grounding validation. */
export function analysisToAnswer(a: PlannerAnalysis): CopilotFinalAnswer {
  return {
    type: 'FINAL_ANSWER',
    answer: a.analysis_summary,
    claims: a.findings.map((f) => ({ claim: f.claim, citation_ids: f.citation_ids, evidence_ids: f.evidence_ids })),
    citations: Array.from(new Set(a.findings.flatMap((f) => f.citation_ids))),
    evidence_ids: Array.from(new Set(a.findings.flatMap((f) => f.evidence_ids))),
    limitations: a.limitations,
    suggested_followups: [],
  };
}

/**
 * Build the grounding context for a review. Only IDs actually present in the
 * critic context are allowed, so fabricated citation/evidence IDs are flagged.
 * Tool-fact tokens are the authoritative deterministic facts (root cause,
 * satellite, evidence summaries, retrieved chunk text, telemetry, alerts).
 */
export function buildCriticGroundingContext(ctx: CriticContext): CopilotGroundingContext {
  const g = createGroundingContext(); // known satellite/investigation/report/alert IDs from DB
  for (const c of ctx.citations) {
    g.allowedCitationIds.add(c.citation_id);
    g.citationText.set(c.citation_id, c.text);
  }
  for (const e of ctx.evidence) g.allowedEvidenceIds.add(e.evidence_id);
  g.accessedInvestigationIds.add(ctx.investigationId);

  const factParts: string[] = [
    ctx.authoritativeRootCause.replace(/_/g, ' '),
    ctx.satelliteId,
    `investigation ${ctx.investigationId}`,
    ctx.subsystem ?? '',
    ...ctx.anomalyTypes.map((a) => a.replace(/_/g, ' ')),
    ...ctx.evidence.map((e) => e.summary),
    `active alerts ${ctx.alertsActiveCount}`,
  ];
  if (ctx.telemetryLatest) {
    for (const [k, v] of Object.entries(ctx.telemetryLatest)) factParts.push(`${k.replace(/_/g, ' ')} ${v}`);
  }
  for (const t of tokenize(factParts.join(' '), { maxTokens: 4096 })) {
    g.toolFactTokens.add(t);
    for (const p of t.split(/[-_]/).filter(Boolean)) g.toolFactTokens.add(p);
  }
  return g;
}

/** Deterministic canonical JSON with sorted keys (stable across runs). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** Stable SHA-256 hex of any JSON-serializable value. */
export function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}
